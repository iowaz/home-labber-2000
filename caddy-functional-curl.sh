curl -i -X POST http://127.0.0.1:2019/load \
  -H 'Content-Type: application/json' \
  --data-binary '{"admin":{"listen":"0.0.0.0:2019"},"apps":{"http":{"servers":{"srv0":{"listen":[":80",":443"],"routes":[{"match":[{"host":["jellyfin.rede.local"]}],"handle":[{"handler":"reverse_proxy","upstreams":[{"dial":"mac.rede.local:8096"}]}]},{"match":[{"host":["adguard.rede.local"]}],"handle":[{"handler":"reverse_proxy","upstreams":[{"dial":"host.docker.internal:3001"}]}]}]}}}}}'
