# SomaLibrary serv infrastructure for AWS

2 modes:
 - prod (static site, editing points at live site):
   - point route53 "www" at static generated site (from the wiki md files)
   - point route53 "editor" at live site
 - dev (fully live):
   - point route53 "www" at live site
   - point route53 "editor" at live site
   - point route53 "www-testing" at static site

# customizing
```
cp .parameters.sourceme.sh parameters.sourceme.sh
```
and edit the values there once you get things set up...

# scripts
Generate/Upload static site to S3, or clear the S3 bucket
 - cpfiles.sh
 - rmfiles.sh

Add an IAM user (optional) - uncomment the env vars (`parameters.sourceme.sh`) for your AWS CLI
 - create_user.sh

Use Cloudformation to create the AWS S3 bucket + Cloudfront infrastructure
 - update_infra.sh
 - destroy_infra.sh

Switch Route53 records from `dev` to `prod`
 - switch_to_prod.sh
 - switch_to_dev.sh


# delayed updates...
Be sure to put the `./cpfiles.sh` on a periodic cron timer, to update the static site.

TODO: minimize upload bandwidth used

INCIDENTALLY:  this is a SIMPLE way to do moderation of the wiki before "releasing it"...   So there's a reason.


