#!/bin/bash
if [ ! -f "parameters.sourceme.sh" ]; then
  echo "error:  parameters.sourceme.sh doesn't exist"
  exit -1
fi
source parameters.sourceme.sh

# upload dummy file (hello world)
#aws s3 cp index.html "s3://$BUCKET_NAME/" --cache-control 'no-cache'

# cache-control
# maxage:
# 86400 seconds = 1 day (1 × 24 × 60 × 60)
# 604800 seconds = 7 days (7 × 24 × 60 × 60)
# 31536000 seconds = 1 year (365 × 24 × 60 × 60)

METADATA_FOR_HTML="--metadata-directive REPLACE --metadata x-amz-meta-referrer-policy=origin-when-cross-origin"

# generate & upload static site
cd ../serv && ./build_static.js; cd -
aws s3 sync ../serv/build/root/ "s3://$BUCKET_NAME/" --cache-control 'no-cache' --content-type 'text/html' $METADATA_FOR_HTML
aws s3 sync ../serv/build/wiki/view/ "s3://$BUCKET_NAME/wiki/view/" --cache-control 'no-cache' --exclude "*.html" --exclude "*.png" --exclude "*.torrent" --exclude "*.sh" --exclude "*.jpg" --exclude "*.svg" --exclude "*.ico" --content-type 'text/html' $METADATA_FOR_HTML
aws s3 sync ../serv/build/wiki/markdown/ "s3://$BUCKET_NAME/wiki/markdown/" --cache-control 'no-cache' --content-type 'text/plain' $METADATA_FOR_HTML

# weird s3 quirk:  /wiki doesn't point to /wiki/index.html, so have to write that index into /wiki as s3 file object
aws s3 cp ../serv/build/root/wiki/view/index "s3://$BUCKET_NAME/wiki" --cache-control 'no-cache'  --content-type 'text/html' $METADATA_FOR_HTML
aws s3 cp ../serv/build/root/wiki/view/index "s3://$BUCKET_NAME/wiki/view" --cache-control 'no-cache'  --content-type 'text/html' $METADATA_FOR_HTML


# images
aws s3 sync ../serv/build/assets/ "s3://$BUCKET_NAME/assets/" --cache-control 'max-age=31536000' --exclude "*.html"
aws s3 sync ../serv/build/wiki/uploads/ "s3://$BUCKET_NAME/wiki/uploads/" --cache-control 'max-age=31536000' --exclude "*.html"

# pdf
aws s3 sync ../serv/build/uploads/ "s3://$BUCKET_NAME/wiki/uploads/files/" --cache-control 'max-age=31536000' --exclude "*.html"

# rss
aws s3 cp ../serv/build/rss "s3://$BUCKET_NAME/" --cache-control 'no-cache' --content-type 'application/rss+xml'

# torrent (we serve them from /rss endpoint, dont get confused :) )
aws s3 sync ../serv/build/torrents/ "s3://$BUCKET_NAME/rss/" --cache-control 'no-cache' --include "*.torrent" --content-type 'application/x-bittorrent'

# robots
aws s3 cp ../serv/build/robots.txt "s3://$BUCKET_NAME/" --cache-control 'max-age=86400' --content-type 'text/plain'

# sitemap
aws s3 cp ../serv/build/sitemap.xml "s3://$BUCKET_NAME/" --cache-control 'no-cache' --content-type 'application/xml'

# active apps
aws s3 cp ../serv/build/wiki/search "s3://$BUCKET_NAME/wiki/" --cache-control 'no-cache' --content-type 'text/html'
aws s3 cp ../serv/build/wiki/search-youtube "s3://$BUCKET_NAME/wiki/" --cache-control 'no-cache' --content-type 'text/html'
aws s3 cp ../serv/build/greek/quizzes "s3://$BUCKET_NAME/greek/quizzes" --cache-control 'no-cache' --content-type 'text/html'

