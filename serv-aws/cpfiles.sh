source parameters.sourceme.sh

# upload dummy file (hello world)
#aws s3 cp index.html "s3://$BUCKET_NAME/" --cache-control 'no-cache'

# generate & upload static site
cd ../serv && ./build_static.js; cd -
aws s3 cp ../serv/build/wiki/view/index "s3://$BUCKET_NAME/" --cache-control 'no-cache'  --content-type 'text/html'
aws s3 cp ../serv/build/wiki/view/index.html "s3://$BUCKET_NAME/" --cache-control 'no-cache'   --content-type 'text/html'
aws s3 cp ../serv/build/wiki/view/ "s3://$BUCKET_NAME/wiki/view/" --cache-control 'no-cache' --exclude "*.html" --exclude "*.png" --exclude "*.torrent" --exclude "*.sh" --exclude "*.jpg" --exclude "*.svg" --exclude "*.ico" --content-type 'text/html' --recursive

aws s3 sync ../serv/build/assets/ "s3://$BUCKET_NAME/assets/" --cache-control 'max-age=31536000' --exclude "*.html"
aws s3 sync ../serv/build/wiki/uploads/ "s3://$BUCKET_NAME/wiki/uploads/" --cache-control 'max-age=31536000' --exclude "*.html"

aws s3 cp ../serv/build/rss "s3://$BUCKET_NAME/" --cache-control 'no-cache' --content-type 'application/rss+xml'
aws s3 sync ../serv/build/torrents/ "s3://$BUCKET_NAME/rss/" --cache-control 'max-age=31536000' --include "*.torrent"
