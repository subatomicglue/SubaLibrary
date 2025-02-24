# soma library - serverless wiki & content system
*** work in progress ***


## Features
- [soma-serv](soma-serv):  fileserver which you can run inside your home network to serve up your own library.
- [soma-wiki](soma-wiki):  serverless wiki & content system built on AWS - *** work in progress ***


# aws info & notes:
developed on:
```
> aws --version
aws-cli/2.24.8 Python/3.12.9 Darwin/24.1.0 source/arm64
```

# cloudformation params usage inside yaml file:
when editing [infra.yaml](infra.yaml)
```
BucketName: !Sub "${BucketName}-suffix"
BucketName: !Ref BucketName
```

# aws credentials are stored outside of this repo...
read up on how to set up aws cli on your computer, enter your credentials.

# edit parameters to customize
see [parameters.json](parameters.json) to customize your *soma-wiki*
- bucketname
- stack name
- hosted zone to use in route53

