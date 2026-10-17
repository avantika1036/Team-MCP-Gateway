#!/usr/bin/env bash
set -Eeuo pipefail

: "${WORDPRESS_URL:?WORDPRESS_URL is required}"
: "${WORDPRESS_TITLE:?WORDPRESS_TITLE is required}"
: "${WORDPRESS_ADMIN_USER:?WORDPRESS_ADMIN_USER is required}"
: "${WORDPRESS_ADMIN_PASSWORD:?WORDPRESS_ADMIN_PASSWORD is required}"
: "${WORDPRESS_ADMIN_EMAIL:?WORDPRESS_ADMIN_EMAIL is required}"

# Start the official WordPress entrypoint in the background.
 /usr/local/bin/docker-entrypoint.sh "$@" &
server_pid=$!

trap 'kill -TERM "$server_pid" 2>/dev/null || true' EXIT
trap 'exit 143' TERM
trap 'exit 130' INT

echo "Waiting for WordPress files and database..."
deadline=$((SECONDS + ${WORDPRESS_INIT_TIMEOUT_SECONDS:-300}))

until [[ -f /var/www/html/wp-config.php ]] &&
      php -r '
        mysqli_report(MYSQLI_REPORT_OFF);
        $dbHost = getenv("WORDPRESS_DB_HOST") ?: "localhost";
        $parts = explode(":", $dbHost, 2);
        $port = isset($parts[1]) ? (int) $parts[1] : 3306;
        $connection = @new mysqli(
            $parts[0],
            getenv("WORDPRESS_DB_USER"),
            getenv("WORDPRESS_DB_PASSWORD"),
            getenv("WORDPRESS_DB_NAME"),
            $port
        );
        if ($connection->connect_errno) { exit(1); }
        $connection->close();
      ' >/dev/null 2>&1; do

    if ! kill -0 "$server_pid" 2>/dev/null; then
        wait "$server_pid"
        echo "WordPress/Apache exited before initialization completed." >&2
        exit 1
    fi

    if (( SECONDS >= deadline )); then
        echo "Timed out waiting for the WordPress database." >&2
        exit 1
    fi

    sleep 3
done

if ! wp core is-installed --path=/var/www/html --allow-root; then
    echo "Installing WordPress..."
    wp core install \
        --path=/var/www/html \
        --url="$WORDPRESS_URL" \
        --title="$WORDPRESS_TITLE" \
        --admin_user="$WORDPRESS_ADMIN_USER" \
        --admin_password="$WORDPRESS_ADMIN_PASSWORD" \
        --admin_email="$WORDPRESS_ADMIN_EMAIL" \
        --skip-email \
        --allow-root
fi

if ! wp plugin is-active woocommerce --path=/var/www/html --allow-root; then
    echo "Activating WooCommerce..."
    wp plugin activate woocommerce --path=/var/www/html --allow-root
fi

echo "WordPress is installed and WooCommerce is active."
wait "$server_pid"