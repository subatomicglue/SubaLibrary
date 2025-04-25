source parameters.sourceme.sh

# make all DNS traffic go through MY LOCAL MACHINE (whatever machine this script is run on)
#  - private.$DOMAINNAME can experimentally go to cloudfront... for testing (treat private like www)

# point the "$EditablEditableHostnameeHost" at local machine's public IP address
../serv/update_host_aws.js --zone "${DomainName}." --value "$(curl -s https://api.ipify.org)" --records "$EditableHostname"
../serv/update_host_aws.js --zone "${DomainName2}." --value "$(curl -s https://api.ipify.org)" --records "$EditableHostname"

# point the "www" host at rootlevel domain
../serv/update_host_aws.js --zone "${DomainName}." --records "www"
../serv/update_host_aws.js --zone "${DomainName2}." --records "www"

# point the rootlevel domain(s) - at localhost's public IP
../serv/update_dns_aws.js --force

# point the "$StaticHostnameForTesting" host at cloudfront static site - for testing (the output from build_static.js)...
../serv/update_host_aws.js --zone "${DomainName}." --value "$CloudfrontDomain" --records "private"
../serv/update_host_aws.js --zone "${DomainName2}." --value "$CloudfrontDomain" --records "private"
