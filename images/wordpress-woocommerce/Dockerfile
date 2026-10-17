FROM wordpress:7.0-php8.3-apache

ARG WOOCOMMERCE_VERSION=11.2.1

RUN apt-get update \
    && apt-get install -y --no-install-recommends curl unzip \
    && rm -rf /var/lib/apt/lists/* \
    && curl -fsSL "https://downloads.wordpress.org/plugin/woocommerce.${WOOCOMMERCE_VERSION}.zip" -o /tmp/woocommerce.zip \
    && unzip -q /tmp/woocommerce.zip -d /usr/src/wordpress/wp-content/plugins \
    && rm /tmp/woocommerce.zip \
    && curl -fsSL https://raw.githubusercontent.com/wp-cli/builds/gh-pages/phar/wp-cli.phar -o /usr/local/bin/wp \
    && chmod +x /usr/local/bin/wp \
    && wp --info --allow-root

COPY urumi-entrypoint.sh /usr/local/bin/urumi-entrypoint.sh

RUN chmod +x /usr/local/bin/urumi-entrypoint.sh

ENTRYPOINT ["urumi-entrypoint.sh"]
CMD ["apache2-foreground"]