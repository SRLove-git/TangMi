# DVWA local lab image (built from reference/dvwa source)
# Build: docker build -f labs/docker/DVWA.Dockerfile -t pentest-agent/dvwa:local reference/dvwa
#
# 说明：容器内直接访问 deb.debian.org 在部分网络环境下很慢，故先切换到国内镜像源并强制 IPv4。
# 如需其他镜像源，构建时传入 --build-arg APT_MIRROR=mirrors.tuna.tsinghua.edu.cn
FROM docker.m.daocloud.io/library/php:8-apache

ARG APT_MIRROR=mirrors.aliyun.com
ENV DEBIAN_FRONTEND=noninteractive

RUN sed -i "s|http://deb.debian.org|http://${APT_MIRROR}|g" /etc/apt/sources.list.d/debian.sources \
 && apt-get -o Acquire::ForceIPv4=true update \
 && apt-get -y --no-install-recommends install \
        zlib1g-dev libpng-dev libjpeg-dev libfreetype6-dev \
        iputils-ping git zip unzip 7zip \
 && rm -rf /var/lib/apt/lists/* \
 && docker-php-ext-configure gd --with-jpeg --with-freetype \
 && a2enmod rewrite \
 && docker-php-ext-install gd mysqli pdo pdo_mysql

WORKDIR /var/www/html

COPY . /var/www/html
COPY config/config.inc.php.dist /var/www/html/config/config.inc.php

RUN chown -R www-data:www-data /var/www/html \
 && printf 'error_reporting = E_ALL & ~E_DEPRECATED & ~E_NOTICE\ndisplay_errors = On\n' > /usr/local/etc/php/conf.d/zz-dvwa.ini

EXPOSE 80
