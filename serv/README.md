# soma serv
a library [wiki + fileserver + rss feed] for your home network.
recommended for a small appliance like raspberry pi
there's a simple passcode system, you can give to your friends

# future features:
- add some popular SSO logins (google, facebook, etc)
- add AWS cognito auth

# contributing: please feel free to open pull request to contribute...
- keep it simple, keep dependencies low.
- keep 0 vulnerabilities with npm audit

# HOWTO setup

## create your config file
```
> cp .soma-serv.json soma-serv.json 
```
Later, once you have the app working, you can customize...

## Set up your app icon
```
> cd assets && ./change_favicon_links.sh default-favicons
```
...you can also create your own, and switch to it using this script

## generate development certs
...for https, and make sure those certs appear in `soma-serv.json`
```
> npm run certs
```
outputs `certs/cert.pem` and `certs/privkey.pem`
These are "self-signed" and you'll have to "accept" them in your browser.
Read later about generating real signed certs with `lets-encrypt`

# HOWTO setup auth
`passcode.json` (simple global passcode auth)
```
"someBetterPasscodeThanThis!!!1"
```

`users.json` (simple user/pass auth)
```
{
    "username1": "someBetterPasswordThanThis!!!1",
    "username2": "someBetterPasswordThanThis!!!2",
    "username3": "someBetterPasswordThanThis!!!3",
}
```

# HOWTO generate and maintain real signed certs - soma-certbot.js
To run the service on HTTPS, you need signed certificates.
You can create certs yourself, for example using `AWS certificate manager`

For you do-it-yourselfers, there's `soma-certbot.js` which uses `LetsEncrypt` and the `acme-client` (see below NOTE to setup config)

`soma-certbot.js` will read your `soma-serv.json` file's `HOSTEDZONES` and `DOMAINS`, 
 - so now's the time to setup `soma-serv.json`.
 - Also, make sure that any hostnames listed in `DOMAINS` also appear in your DNS (AWS Route53, godaddy, etc.)

Now, run the `staging` certbot, with `start-certbot-dev`:
```
> npm run start-certbot-dev
> npm run logs
```
This starts the certbot under `pm2` (can delete it with `pm2 delete soma-certbot-staging`, list processes with `pm2 list`)

Use `staging` to get it working.
 - verify certs work in the browser
 - verify no errors in the logs

Once working, switch to `production` certbot, with `start-certbot`
```
> pm2 list
... lists all running pm2 processes ...
> pm2 delete soma-certbot-staging
> npm run start-certbot
```

Letsencrypt puts penalties on you for retrying too many times in `production`, which is why we get it working under `staging` first.

## AWS Route53 - dynamic dns 
For hosting on a computer with dynamic IP address,
You can use the script `update_dns_aws.js` to update your IP address periodically.  It'll update your AWS Route53 HostedZone's A record to the new IP address.

## AWS Route53 - create new hostnames
Tired of `www.example.com` and rather have `fireworx.example.com`?

You can use the script `update_host_aws.js` to add new hosts to your AWS Route53 HostedZone, like `www`, `fireworx` etc...  It'll update your AWS Route53 HostedZone's CNAME record to the new IP address.

Purely a convenience, you can also do this in your DNS console by hand.

# HOWTO get help
```
> npm run help

npm run ...
  certs (self-signed)
  start-certbot-dev (letsencrypt staging)
  start-certbot (letsencrypt prod - be careful!)
  expose-wifi
  systemd-install | systemd-uninstall | systemd-reinstall
  systemd-status | systemd-logs
  systemd-start | systemd-stop | systemd-restart
  start | logs | stop | restart | delete
```

# HOWTO run (development)
**dev:** run soma-serv on port 3002:
```
NODE_PORT=3002 ./soma-serv.js
```
TIP: set `USE_HTTPS` to `false` in `soma-serv.json`

**prod:** run soma-serv with HTTP on port 80 and HTTPS on port 443:
```
NODE_HTTP_PORT=80 NODE_HTTPS_PORT=443 ./soma-serv.js
```

# HOWTO serve (production)
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

See section on running `soma-certbot.js` above, for certificate signing for https.

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

# Customizing
After you get it running, you can
Look at `soma-serv.json`, and edit settings there...



# Running pm2 as systemd on raspberry pi (NOTES)

 - rPi: Raspberry Pi 4b
 - OS:  Raspian bookworm-lite 12 (64bit)
 - Storage:
   - Boot:  sandisk 32GB A1 (sdcard)
   - App:   samsung 256GB   (USB drive)

here we've
 - burned a sdcard with Raspian bookworm-lite 12 (64bit)
 - mounted the app drive at /var/usbmount
 - symlinked /var/usbmount to /home/pi/src
 - the app running in `/home/pi/src/SomaLibrary/serv`
 - using pm2 to save state into a systemd configuration, will restore service automatically on reboot.

```
cd /home/pi/src/SomaLibrary/serv

# run pm2, verify that you can load the app from a browser...
npm run start
npm run start-certbot

# save the pm2 config
./node_modules/.bin/pm2 save

# run this to output the next command that you can run
./node_modules/.bin/pm2 startup systemd

# command from the previous line...
sudo env PATH=$PATH:/home/pi/.nvm/versions/node/v18.0.0/bin /var/usbdrive/SomaLibrary/serv/node_modules/.bin/pm2 startup systemd -u pi --hp /home/pi

# enable the new pm2-pi process
sudo systemctl enable pm2-pi

# get some status about why it is or isn't running...
systemctl status pm2-pi
journalctl -u pm2-pi.service --no-pager

# edit the systemd process, see config below for one that works on raspbian buster (32bit)
sudo nano /etc/systemd/system/pm2-pi.service

# reload systemd, restart the daemon
sudo systemctl daemon-reload
sudo systemctl restart pm2-pi
systemctl status pm2-pi

# dont see a pid file?   force it again...  (see below ExecStartPost which creates the pid)
./node_modules/.bin/pm2 kill
./node_modules/.bin/pm2 resurrect
ls /home/pi/.pm2/pm2.pid
```

`sudo nano /etc/systemd/system/pm2-pi.service`
```
[Unit]
Description=PM2 process manager
Documentation=https://pm2.keymetrics.io/
After=network.target
After=local-fs.target
Requires=local-fs.target

[Service]
Type=forking
User=pi
LimitNOFILE=infinity
LimitNPROC=infinity
LimitCORE=infinity
Environment=PATH=/home/pi/.nvm/versions/node/v18.0.0/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:/usr/local/games:/usr/games:/snap/bin:/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin
Environment=PM2_HOME=/home/pi/.pm2
PIDFile=/home/pi/.pm2/pm2.pid
Restart=on-failure

ExecStart=/var/usbdrive/SomaLibrary/serv/node_modules/.bin/pm2 resurrect
ExecReload=/var/usbdrive/SomaLibrary/serv/node_modules/.bin/pm2 reload all
ExecStop=/var/usbdrive/SomaLibrary/serv/node_modules/.bin/pm2 kill
ExecStartPost=/bin/sh -c "echo $(pgrep PM2) > /home/pi/.pm2/pm2.pid"

[Install]
WantedBy=multi-user.target
```

