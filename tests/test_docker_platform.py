"""跨平台 Docker 支持测试：平台识别、镜像源选择、架构模拟与拉取回退（不依赖真实 Docker）。"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from pentest_agent.core import docker_platform as dp  # noqa: E402
from pentest_agent.web import deploy as deploy_mod  # noqa: E402
from pentest_agent.web.deploy import DockerCLI, DockerError, LabDeployManager  # noqa: E402


# --------------------------------------------------------------------- 镜像源
def test_mirror_candidates_official_image():
    hosts = ("docker.1ms.run", "docker.m.daocloud.io")
    refs = dp.mirror_candidates("redis:7-alpine", hosts)
    assert refs == [
        "docker.1ms.run/library/redis:7-alpine",
        "docker.m.daocloud.io/library/redis:7-alpine",
    ]


def test_mirror_candidates_namespaced_image():
    refs = dp.mirror_candidates("bkimminich/juice-shop:latest", ("docker.1ms.run",))
    assert refs == ["docker.1ms.run/bkimminich/juice-shop:latest"]


def test_mirror_skips_non_hub_images():
    # 本地构建 / 其它 registry 的镜像不应该加国内镜像前缀
    assert dp.mirror_candidates("pentest-agent/dvwa:local", ("docker.1ms.run",)) == []
    assert dp.mirror_candidates("ghcr.io/foo/bar:1", ("docker.1ms.run",)) == []
    assert dp.is_docker_hub_ref("redis:7") is True
    assert dp.is_docker_hub_ref("docker.io/library/redis:7") is True
    assert dp.canonical_hub_path("docker.io/library/redis:7") == "library/redis:7"


def test_mirror_env_override(monkeypatch):
    monkeypatch.setenv("PENTEST_DOCKER_MIRRORS", "a.example.com, b.example.com")
    assert dp.get_mirrors() == ("a.example.com", "b.example.com")
    monkeypatch.setenv("PENTEST_DOCKER_NO_MIRROR", "1")
    assert dp.get_mirrors() == ()


def test_mirror_label():
    assert "3" in dp.mirror_label(("a", "b", "c"))
    assert "未启用" in dp.mirror_label(())


def test_default_mirrors_are_domestic():
    hosts = dp.DEFAULT_DOCKER_MIRRORS
    assert hosts, "默认应内置国内镜像源"
    assert any("daocloud" in host or "1ms" in host or "1panel" in host for host in hosts)


# --------------------------------------------------------------------- 架构
def test_resolve_platform():
    # 同架构不再额外传 --platform
    assert dp.resolve_platform("linux/amd64", arch="x86_64") is None
    assert dp.resolve_platform("linux/arm64", arch="arm64") is None
    # 跨架构才模拟
    assert dp.resolve_platform("linux/amd64", arch="arm64") == "linux/amd64"
    assert dp.resolve_platform("linux/arm64", arch="x86_64") == "linux/arm64"
    # 多架构镜像自动选择
    assert dp.resolve_platform(None) is None


def test_emulation_note():
    assert "模拟" in dp.emulation_note("linux/amd64")
    assert dp.emulation_note(None) == ""


# --------------------------------------------------------------------- 平台
def test_platform_labels():
    assert dp.SYSTEM_LABEL
    assert dp.ARCH_LABEL
    assert "·" in dp.PLATFORM_LABEL
    assert dp.PLATFORM_LABEL.startswith(dp.SYSTEM_LABEL)


def test_subprocess_kwargs_utf8():
    kwargs = dp.subprocess_kwargs()
    assert kwargs["encoding"] == "utf-8"
    assert kwargs["text"] is True


def test_subprocess_kwargs_windows_hides_console(monkeypatch):
    monkeypatch.setattr(dp, "IS_WINDOWS", True)
    kwargs = dp.subprocess_kwargs()
    assert kwargs.get("creationflags"), "Windows 下应隐藏子进程控制台窗口"


def test_find_docker_prefers_path(monkeypatch):
    monkeypatch.setattr(dp.shutil, "which", lambda name: "/fake/bin/docker")
    assert dp.find_docker() == "/fake/bin/docker"


def test_install_and_start_hints_are_platform_specific():
    hint = dp.install_hint()
    assert "docker" in hint.lower()
    assert dp.start_hint()


# --------------------------------------------------------------------- 拉取回退
def test_pull_with_mirror_uses_first_working_mirror(monkeypatch):
    monkeypatch.setattr(deploy_mod, "get_mirrors", lambda: ("m1.example.com", "m2.example.com"))
    cli = DockerCLI()
    calls: list[str] = []
    tagged: list[tuple[str, str]] = []

    def fake_pull(image, on_line, platform_tag=None):
        calls.append(image)
        if image.startswith("m1."):
            raise DockerError("m1 unavailable")
        on_line(f"pulling {image}")

    cli.pull = fake_pull  # type: ignore[method-assign]
    cli.tag = lambda source, target: tagged.append((source, target))  # type: ignore[method-assign]
    resolved = cli.pull_with_mirror("redis:7-alpine", lambda line: None)
    assert resolved == "redis:7-alpine"
    assert calls == [
        "m1.example.com/library/redis:7-alpine",
        "m2.example.com/library/redis:7-alpine",
    ]
    assert tagged == [("m2.example.com/library/redis:7-alpine", "redis:7-alpine")]


def test_pull_with_mirror_falls_back_to_official(monkeypatch):
    monkeypatch.setattr(deploy_mod, "get_mirrors", lambda: ("m1.example.com",))
    cli = DockerCLI()
    calls: list[str] = []

    def fake_pull(image, on_line, platform_tag=None):
        calls.append(image)
        if image.startswith("m1."):
            raise DockerError("mirror down")

    cli.pull = fake_pull  # type: ignore[method-assign]
    cli.tag = lambda source, target: None  # type: ignore[method-assign]
    resolved = cli.pull_with_mirror("bkimminich/juice-shop:latest", lambda line: None)
    assert resolved == "bkimminich/juice-shop:latest"
    assert calls[-1] == "bkimminich/juice-shop:latest"


def test_pull_with_mirror_returns_mirror_ref_when_tag_fails(monkeypatch):
    monkeypatch.setattr(deploy_mod, "get_mirrors", lambda: ("m1.example.com",))
    cli = DockerCLI()
    cli.pull = lambda image, on_line, platform_tag=None: None  # type: ignore[method-assign]

    def bad_tag(source, target):
        raise DockerError("cannot tag")

    cli.tag = bad_tag  # type: ignore[method-assign]
    resolved = cli.pull_with_mirror("redis:7-alpine", lambda line: None)
    assert resolved == "m1.example.com/library/redis:7-alpine"


# --------------------------------------------------------------------- 部署中心数据
class _FakeDocker(DockerCLI):
    def __init__(self):
        self._fake_available = (True, "29.0.0")

    def available(self):
        return self._fake_available

    def ps_all(self):
        return []

    def images(self):
        return set()

    def image_exists(self, image):
        return False


def test_catalog_reports_platform_and_mirrors(tmp_path, monkeypatch):
    monkeypatch.setattr(deploy_mod, "get_mirrors", lambda: ("docker.1ms.run", "docker.m.daocloud.io"))
    manager = LabDeployManager(tmp_path, docker=_FakeDocker())
    data = manager.catalog()["docker"]
    assert data["available"] is True
    assert data["platform_label"]
    assert data["arch"]
    assert data["mirror_enabled"] is True
    assert data["mirrors"] == ["docker.1ms.run", "docker.m.daocloud.io"]
    assert "国内镜像" in data["mirror_label"]


def test_public_entry_marks_mirrorable_image(tmp_path):
    manager = LabDeployManager(tmp_path, docker=_FakeDocker())
    entry = next(item for item in manager.catalog()["labs"] if item["key"] == "juice-shop")
    assert entry["mirror"] is True
    dvwa = next(item for item in manager.catalog()["labs"] if item["key"] == "dvwa")
    assert dvwa["builtin"] is True
