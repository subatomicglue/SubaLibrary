# soma serv
a library fileserver for your home network.
recommended for a small appliance like raspberry pi
there's a simple passcode system, you can give to your friends

# future features:
- add some popular SSO logins (google, facebook, etc)
- add AWS cognito auth

# contributing: please feel free to open pull request to contribute...
- keep it simple, keep dependencies low.
- keep 0 vulnerabilities with npm audit

# HOWTO setup
look at `soma-serv.json`, and edit settings there...

generate development certs for https, and make sure those certs appear in `soma-serv.json`
```
> npm run certs
```

# HOWTO setup auth
`passcode.json` (simple global passcode auth)
```
"my passcode"
```

`users.json` (simple user/pass auth)
```
{
    "username1": "someBetterPasswordThanThis!!!1"
}
```


# HOWTO get help
```
> npm run help

npm run ...
  certs
  expose-wifi
  systemd-install | systemd-uninstall | systemd-reinstall
  systemd-status | systemd-logs
  systemd-start | systemd-stop | systemd-restart
  start | logs | stop | restart
```

# HOWTO run
run soma-serv on port 3002:
```
NODE_PORT=3002 ./soma-serv.js
```

# HOWTO serve
1. look up port forwarding for your WiFi router, learn how to expose an ip/port
2. get stats about the machine you'll be running soma-serv on
```
> npm run expose-wifi
```
3. read the internal ip & port, enter into your wifi router port forwarding config
4. read the external ip & port, enter into your webbrowser
5. voila... :)

# HOWTO serve - pm2
start soma-serv with pm2, which will watch and restart if script changes
```
npm run start
```

show logs
```
npm run logs
```

# HOWTO serve - systemd
setup/start systemd soma-serv service
```
> npm run systemd-setup
```

status for systemd soma-serv service
```
> npm run systemd-status
```

restart systemd soma-serv service
```
> npm run systemd-restart
```

