#!/bin/bash

rm -f ./favicon.ico ./apple-touch-icon-precomposed.png ./apple-touch-icon.png ./favicons

ln -s `pwd`/"$1"/favicon.ico ./favicon.ico
ln -s `pwd`/"$1"/apple-touch-icon-precomposed.png ./apple-touch-icon-precomposed.png
ln -s `pwd`/"$1"/apple-touch-icon.png ./apple-touch-icon.png
ln -s `pwd`/"$1"/ ./favicons

