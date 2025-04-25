#!/bin/bash

rm -f ./favicon.ico ./apple-touch-icon-precomposed.png ./apple-touch-icon.png ./favicons ./favicon-128.png

ln -s `pwd`/"$1"/favicon.ico ./favicon.ico
ln -s `pwd`/"$1"/favicon-128x128.png ./favicon-128.png
ln -s `pwd`/"$1"/apple-touch-icon-180x180.png ./apple-touch-icon-precomposed.png
ln -s `pwd`/"$1"/apple-touch-icon-180x180.png ./apple-touch-icon.png
ln -s `pwd`/"$1"/ ./favicons

