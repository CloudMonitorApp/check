composer install --no-interaction --prefer-dist

php artisan cloudmonitor:check \
  --ci \
  --fail-on=${FAIL_ON} \
  --baseline=${BASELINE} \
  --environments=${ENVIRONMENTS}
