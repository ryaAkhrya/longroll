# TURN (DEC-073 OPEN)

Status: **konfigurasi acuan saja — TURN nyata belum ada, TC-SEC-019 NOT VERIFIED.**

- Service realtime sudah menerbitkan kredensial HMAC sementara (TTL 1 jam, hanya untuk pemegang token room) bila
  `TURN_URLS` + `TURN_SHARED_SECRET` diset; tanpa itu hanya STUN (`turn:false`).
- `turnserver.conf` memuat deny-list peer (privat/loopback/link-local/CGNAT/multicast/metadata). Untuk penyedia TURN
  terkelola, minta/atur setara (mis. "deny private IP ranges"), lalu uji manual: dari klien tes, `turnutils_uclient -y`
  dengan peer `127.0.0.1`, `10.x`, `169.254.169.254` harus ditolak (403 Forbidden IP).
- Ukur `rtc_relay_ratio` di perangkat nyata sebelum memutuskan DEC-073.
