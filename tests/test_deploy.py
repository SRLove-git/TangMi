"""靶场部署中心测试：目录、状态识别、端口分配、部署任务与 API（FakeDocker，不操作真实 Docker）。"""

from __future__ import annotations

import json
import sys
import time
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from pentest_agent.web.deploy import (  # noqa: E402
    IS_ARM,
    LAB_CATALOG,
    DockerCLI,
    DockerError,
    LabDeployManager,
    get_lab,
    match_lab,
)
from pentest_agent.web.server import create_app  # noqa: E402


# --------------------------------------------------------------------- 工装
class FakeDocker(DockerCLI):
    """内存版 Docker，实现管理器用到的最小接口。"""

    def __init__(
        self,
        *,
        available: tuple[bool, str] = (True, "29.0.0"),
        containers: list[dict] | None = None,
        images: set[str] | None = None,
        image_sizes: dict[str, int] | None = None,
    ) -> None:
        self._fake_available = available
        self.containers = [dict(item) for item in (containers or [])]
        self.image_set = set(images or [])
        self.image_sizes = dict(image_sizes or {})
        self.removed_images: list[str] = []
        self.pulled: list[tuple[str, str | None]] = []
        self.runs: list[dict] = []
        self.started: list[str] = []
        self.stopped: list[str] = []
        self.removed: list[str] = []

    # 状态
    def available(self):  # noqa: D102
        return self._fake_available

    def ps_all(self):  # noqa: D102
        return [dict(item) for item in self.containers]

    def images(self):  # noqa: D102
        return set(self.image_set)

    def image_exists(self, image):  # noqa: D102
        return image in self.image_set

    def image_size(self, image):  # noqa: D102
        return int(self.image_sizes.get(image, 0))

    def remove_image(self, image):  # noqa: D102
        if image not in self.image_set:
            raise DockerError(f"镜像不存在：{image}")
        self.removed_images.append(image)
        self.image_set.discard(image)

    # 动作
    def pull(self, image, on_line, platform_tag=None):  # noqa: D102
        self.pulled.append((image, platform_tag))
        on_line(f"pulling {image}")
        self.image_set.add(image)

    def run(self, *, image, name, host_port, container_port, platform_tag=None, env=None, command=None):  # noqa: D102
        self.runs.append(
            {
                "image": image,
                "name": name,
                "host_port": host_port,
                "container_port": container_port,
                "platform_tag": platform_tag,
                "env": env,
                "command": command,
            }
        )
        self.containers.append(
            {
                "Names": name,
                "Image": image,
                "Status": "Up 1 second",
                "Ports": f"127.0.0.1:{host_port}->{container_port}/tcp",
            }
        )
        return "container-id"

    def start(self, name):  # noqa: D102
        self.started.append(name)
        for container in self.containers:
            if name in str(container.get("Names") or ""):
                container["Status"] = "Up 1 second"

    def stop(self, name):  # noqa: D102
        self.stopped.append(name)
        for container in self.containers:
            if name in str(container.get("Names") or ""):
                container["Status"] = "Exited (0) 1 second ago"

    def remove(self, name):  # noqa: D102
        self.removed.append(name)
        self.containers = [
            item for item in self.containers if name not in str(item.get("Names") or "")
        ]

    def logs(self, name, tail=200):  # noqa: D102
        return [f"fake log for {name}"]


def _manager(tmp_path: Path, docker: FakeDocker | None = None) -> LabDeployManager:
    return LabDeployManager(tmp_path, docker=docker or FakeDocker())


def _wait_task(manager: LabDeployManager, key: str, timeout: float = 8.0):
    deadline = time.time() + timeout
    while time.time() < deadline:
        task = manager.task(key)
        if task is not None and task.status != "running":
            return task
        time.sleep(0.05)
    raise AssertionError(f"等待部署任务超时：{key}")


@pytest.fixture(autouse=True)
def _no_network_health(monkeypatch):
    """健康检查全部返回 True，测试不访问真实网络。"""
    monkeypatch.setattr(
        LabDeployManager, "_health", lambda self, entry, port, force=False: True
    )
    monkeypatch.setattr(LabDeployManager, "_port_free", staticmethod(lambda port: True))


@pytest.fixture()
def app(tmp_path):
    application = create_app(tmp_path)
    application.config.update(TESTING=True)
    return application


def _fake_app(app, docker: FakeDocker) -> LabDeployManager:
    manager = LabDeployManager(Path(app.config["CHAT"].root), docker=docker)
    app.config["DEPLOY"] = manager
    return manager


# --------------------------------------------------------------------- 目录
def test_catalog_structure(tmp_path):
    manager = _manager(tmp_path)
    catalog = manager.catalog()
    assert catalog["docker"]["available"] is True
    assert catalog["total"] == len(LAB_CATALOG) == 16
    assert catalog["running"] == 0
    keys = {lab["key"] for lab in catalog["labs"]}
    assert {"dvwa", "sqli-labs", "juice-shop", "webgoat", "dvga", "vampi", "redis"} <= keys
    categories = {item["key"] for item in catalog["categories"]}
    assert {"web", "injection", "upload", "api", "infra", "classic"} == categories
    lab = next(item for item in catalog["labs"] if item["key"] == "dvga")
    assert lab["image"] == "dolevf/dvga:latest"
    assert lab["runtime"]["state"] == "not_installed"
    assert lab["category_label"] == "API / GraphQL"


def test_catalog_detects_running_and_legacy_containers(tmp_path):
    docker = FakeDocker(
        containers=[
            {
                "Names": "pentest-labs-dvwa-1",
                "Image": "pentest-agent/dvwa:local",
                "Status": "Up 2 days",
                "Ports": "127.0.0.1:4280->80/tcp",
            },
            {
                "Names": "pentest-lab-juice",
                "Image": "bkimminich/juice-shop",
                "Status": "Up 8 hours",
                "Ports": "127.0.0.1:13000->3000/tcp",
            },
        ],
        images={"pentest-agent/dvwa:local", "bkimminich/juice-shop:latest"},
    )
    manager = _manager(tmp_path, docker)
    catalog = manager.catalog()
    labs = {lab["key"]: lab for lab in catalog["labs"]}
    dvwa = labs["dvwa"]["runtime"]
    assert dvwa["state"] == "running"
    assert dvwa["port"] == 4280
    assert dvwa["url"] == "http://127.0.0.1:4280/login.php"
    assert dvwa["adopted"] is False  # 内置 compose 容器
    assert labs["dvwa"]["builtin"] is True

    juice = labs["juice-shop"]["runtime"]
    assert juice["state"] == "running"
    assert juice["port"] == 13000
    assert juice["adopted"] is True
    assert juice["healthy"] is True
    assert labs["juice-shop"]["runtime"]["image_present"] is True


def test_catalog_does_not_adopt_unrelated_redis(tmp_path):
    docker = FakeDocker(
        containers=[
            {
                "Names": "diy-redis-dev-alt",
                "Image": "redis:7",
                "Status": "Exited (255) 2 weeks ago",
                "Ports": "0.0.0.0:6380->6379/tcp",
            }
        ]
    )
    catalog = _manager(tmp_path, docker).catalog()
    redis_lab = next(lab for lab in catalog["labs"] if lab["key"] == "redis")
    assert redis_lab["runtime"]["state"] == "not_installed"


# --------------------------------------------------------------------- 端口
def test_pick_port_avoids_used_ports(tmp_path):
    docker = FakeDocker(
        containers=[
            {
                "Names": "busy",
                "Image": "x/y:latest",
                "Status": "Up 1 hour",
                "Ports": "127.0.0.1:8090->80/tcp, 127.0.0.1:8091->80/tcp",
            }
        ]
    )
    manager = _manager(tmp_path, docker)
    entry = get_lab("mutillidae")
    assert entry is not None
    assert manager._pick_port(entry, docker.ps_all()) == 8092


def test_pick_port_reuses_recorded_port(tmp_path):
    manager = _manager(tmp_path)
    manager._state["labs"]["mutillidae"] = {"port": 8099}
    entry = get_lab("mutillidae")
    assert entry is not None
    assert manager._pick_port(entry, []) == 8099


# --------------------------------------------------------------------- 部署
def test_install_success_flow(tmp_path):
    docker = FakeDocker(images={"dolevf/dvga:latest"})
    manager = _manager(tmp_path, docker)
    task = manager.start_task("dvga", "install")
    assert task.status == "running"
    finished = _wait_task(manager, "dvga")
    assert finished.status == "success", finished.error
    assert docker.runs, "应该执行 docker run"
    run = docker.runs[0]
    assert run["image"] == "dolevf/dvga:latest"
    assert run["name"] == "pa-lab-dvga"
    assert run["container_port"] == 5013
    assert run["host_port"] == 5013
    assert run["platform_tag"] == ("linux/amd64" if IS_ARM else None)
    # 端口记录持久化
    state = json.loads((tmp_path / "web_data" / "labs_deploy.json").read_text(encoding="utf-8"))
    assert state["labs"]["dvga"]["port"] == 5013
    # 状态变为运行中（清空 ps 缓存后重新读取）
    manager._ps_cache = (0.0, [])
    status = manager.status("dvga")
    assert status["runtime"]["state"] == "running"
    assert status["runtime"]["url"] == "http://127.0.0.1:5013/"


def test_install_pulls_missing_image(tmp_path):
    docker = FakeDocker(images=set())
    manager = _manager(tmp_path, docker)
    manager.start_task("redis", "install")
    finished = _wait_task(manager, "redis")
    assert finished.status == "success", finished.error
    assert docker.pulled and docker.pulled[0][0] == "redis:7-alpine"
    assert docker.runs[0]["host_port"] == 6379


def test_install_reuses_running_container(tmp_path):
    docker = FakeDocker(
        containers=[
            {
                "Names": "pentest-lab-vampi",
                "Image": "erev0s/vampi",
                "Status": "Up 8 hours",
                "Ports": "127.0.0.1:15000->5000/tcp",
            }
        ],
        images={"erev0s/vampi:latest"},
    )
    manager = _manager(tmp_path, docker)
    manager.start_task("vampi", "install")
    finished = _wait_task(manager, "vampi")
    assert finished.status == "success"
    assert "已在运行" in finished.message
    assert docker.runs == []


def test_start_stop_remove_lifecycle(tmp_path):
    container = {
        "Names": "pentest-lab-pikachu",
        "Image": "area39/pikachu",
        "Status": "Exited (0) 1 hour ago",
        "Ports": "127.0.0.1:8092->80/tcp",
    }
    docker = FakeDocker(containers=[container])
    manager = _manager(tmp_path, docker)

    manager.start_task("pikachu", "start")
    finished = _wait_task(manager, "pikachu")
    assert finished.status == "success", finished.error
    assert docker.started == ["pentest-lab-pikachu"]

    manager.start_task("pikachu", "stop")
    finished = _wait_task(manager, "pikachu")
    assert finished.status == "success"
    assert docker.stopped == ["pentest-lab-pikachu"]

    manager.start_task("pikachu", "remove")
    finished = _wait_task(manager, "pikachu")
    assert finished.status == "success"
    assert docker.removed == ["pentest-lab-pikachu"]


def test_docker_unavailable(tmp_path):
    docker = FakeDocker(available=(False, "Docker 守护进程未运行，请先启动 Docker Desktop"))
    manager = _manager(tmp_path, docker)
    catalog = manager.catalog()
    assert catalog["docker"]["available"] is False
    assert catalog["running"] == 0

    manager.start_task("dvga", "install")
    finished = _wait_task(manager, "dvga")
    assert finished.status == "failed"
    assert "Docker" in finished.error


def test_unknown_lab_and_action(tmp_path):
    manager = _manager(tmp_path)
    with pytest.raises(KeyError):
        manager.start_task("not-a-lab", "install")
    with pytest.raises(ValueError):
        manager.start_task("dvga", "explode")
    with pytest.raises(KeyError):
        manager.status("not-a-lab")


def test_match_lab_natural_language():
    assert match_lab("帮我部署 juice shop") == "juice-shop"
    assert match_lab("安装一个 WebGoat 靶场") == "webgoat"
    assert match_lab("装个皮卡丘") == "pikachu"
    assert match_lab("部署 redis 未授权环境") == "redis"
    assert match_lab("install express app") is None


# --------------------------------------------------------------------- API
def test_deploy_api_catalog_and_action(app):
    docker = FakeDocker(images={"dolevf/dvga:latest"})
    manager = _fake_app(app, docker)
    with app.test_client() as client:
        catalog = client.get("/api/deploy/catalog")
        assert catalog.status_code == 200
        data = catalog.get_json()
        assert data["total"] == 16
        assert data["docker"]["available"] is True

        response = client.post("/api/deploy/dvga/install")
        assert response.status_code == 202
        assert response.get_json()["task"]["status"] == "running"

        finished = _wait_task(manager, "dvga")
        assert finished.status == "success"

        status = client.get("/api/deploy/dvga/status").get_json()
        manager._ps_cache = (0.0, [])
        status = client.get("/api/deploy/dvga/status").get_json()
        assert status["runtime"]["state"] == "running"

        logs = client.get("/api/deploy/dvga/logs").get_json()
        assert logs["lab"] == "dvga"
        assert any("docker run" in line or "容器" in line for line in logs["lines"])

        assert client.post("/api/deploy/nope/install").status_code == 404
        assert client.post("/api/deploy/dvga/explode").status_code == 400


# --------------------------------------------------------------------- 对话意图
def test_chat_deploy_intent():
    from pentest_agent.web.agent import ChatAgent

    agent = ChatAgent.__new__(ChatAgent)
    assert agent._plan("帮我部署 Juice Shop", None) == {
        "action": "deploy_lab",
        "lab_key": "juice-shop",
    }
    assert agent._plan("安装 DVGA 靶场", None)["action"] == "deploy_lab"
    assert agent._plan("有哪些靶场可以部署", None)["action"] == "deploy_catalog"
    assert agent._plan("安装 express app", None).get("action") != "deploy_lab"


# --------------------------------------------------------------------- 磁盘
def test_disk_usage_and_prune(tmp_path):
    docker = FakeDocker(
        containers=[
            {
                "Names": "pentest-lab-juice",
                "Image": "bkimminich/juice-shop",
                "Status": "Up 8 hours",
                "Ports": "127.0.0.1:13000->3000/tcp",
            }
        ],
        images={
            "bkimminich/juice-shop:latest",
            "dolevf/dvga:latest",
            "redis:7-alpine",
        },
        image_sizes={
            "bkimminich/juice-shop:latest": 500 * 1024 * 1024,
            "dolevf/dvga:latest": 200 * 1024 * 1024,
            "redis:7-alpine": 50 * 1024 * 1024,
        },
    )
    manager = _manager(tmp_path, docker)
    disk = manager.disk_usage()
    assert disk["available"] is True
    # legacy 容器镜像没有 tag，也要识别为「使用中」
    juice = next(item for item in disk["images"] if item["image"].startswith("bkimminich"))
    assert juice["in_use"] is True
    assert "pentest-lab-juice" in juice["containers"]
    assert set(disk["prune_candidates"]) == {"dolevf/dvga:latest", "redis:7-alpine"}
    assert disk["total_mb"] == 750.0
    assert disk["prune_mb"] == 250.0

    result = manager.prune_images()
    assert result["ok"] is True
    assert set(result["removed_images"] if "removed_images" in result else []) == set()
    assert {item["image"] for item in result["removed"]} == {
        "dolevf/dvga:latest",
        "redis:7-alpine",
    }
    assert result["freed_mb"] == 250.0
    assert set(docker.removed_images) == {"dolevf/dvga:latest", "redis:7-alpine"}
    assert "bkimminich/juice-shop:latest" in docker.image_set


def test_deploy_disk_api(app):
    docker = FakeDocker(
        images={"dolevf/dvga:latest"},
        image_sizes={"dolevf/dvga:latest": 100 * 1024 * 1024},
    )
    _fake_app(app, docker)
    with app.test_client() as client:
        disk = client.get("/api/deploy/disk")
        assert disk.status_code == 200
        data = disk.get_json()
        assert data["available"] is True
        assert data["total_mb"] == 100.0
        assert data["prune_candidates"] == ["dolevf/dvga:latest"]

        pruned = client.post("/api/deploy/prune")
        assert pruned.status_code == 200
        result = pruned.get_json()
        assert result["freed_mb"] == 100.0
        assert result["removed"][0]["image"] == "dolevf/dvga:latest"


def test_local_labs_returns_running_http_labs(tmp_path):
    docker = FakeDocker(
        containers=[
            {
                "Names": "pentest-lab-juice",
                "Image": "bkimminich/juice-shop",
                "Status": "Up 8 hours",
                "Ports": "127.0.0.1:13000->3000/tcp",
            },
            {
                "Names": "pentest-lab-mongo",
                "Image": "mongo:4.4",
                "Status": "Up 8 hours",
                "Ports": "127.0.0.1:27017->27017/tcp",
            },
            {
                "Names": "pa-lab-pikachu",
                "Image": "area39/pikachu",
                "Status": "Exited (0) 1 hour ago",
                "Ports": "127.0.0.1:8092->80/tcp",
            },
        ]
    )
    manager = _manager(tmp_path, docker)
    labs = manager.local_labs()
    names = {item["name"] for item in labs}
    assert "OWASP Juice Shop" in names
    # TCP 靶场与已停止容器不进入「可建项目」列表
    assert "MongoDB 未授权访问" not in names
    assert "Pikachu 皮卡丘靶场" not in names
    juice = next(item for item in labs if item["name"] == "OWASP Juice Shop")
    assert juice["target"] == "http://127.0.0.1:13000/"
