const AWS = require('aws-sdk');
const winston = require('winston');
const ec2 = new AWS.EC2({
    apiVersion: '2016-11-15'
});


/**
 * Creates the service group with the given name if it doesn't exist already
 * 
 * The group created here does not have any ingress rules at first. Those must be
 * manually added
 * 
 * @param {String} groupName - The name of the security group that will be created
 * @param {String} vpcId - The ID of the VPC in which to create the security group
 * @returns {Promise.<SecurityGroup>} - A Promise of the Security group
 */
exports.createSecurityGroupIfNotExists = function(groupName, vpcId) {
    return exports.getSecurityGroup(groupName, vpcId)
        .then(securityGroup => {
            if(securityGroup) {
                return securityGroup;
            }
            else {
                return exports.createSecurityGroup(groupName, vpcId);
            }
        });
}


/**
 * Creates the service group with the given name if it doesn't exist already
 * 
 * The group created here does not have any ingress rules at first. Those must be
 * manually added
 * 
 * @param {String} groupName - The name of the security group that will be created
 * @param {String} vpcId - The ID of the VPC in which to create the security group
 * @returns {Promise.<SecurityGroup>} - A Promise of the Security group
 */
exports.createSecurityGroup = function(groupName, vpcId) {
    let createSgParams = {
        Description: groupName,
        GroupName: groupName,
        VpcId: vpcId
    }
    return ec2.createSecurityGroup(createSgParams).promise()
        .then(createResult => {
            return exports.getSecurityGroup(groupName, vpcId)
                .then(securityGroup => {
                    if(securityGroup) {
                        return securityGroup;
                    }
                    else {
                        throw new Error(`Couldn't find created security group ${groupName}`);
                    }
                });
        })
        .then(securityGroup => {
            return exports.tagResource(securityGroup['GroupId'], [
                {
                    Key: "Name",
                    Value: securityGroup['GroupName']
                }
            ])
            .then(tagResult => {
                return securityGroup;
            })
        });
}


/**
 * Returns the information about the requested security group if it exists.
 * 
 * @param {String} groupName - The name of the security group to search for
 * @param {String} vpcId - The ID of the VPC in which to look for the security group
 * @returns {Promise.<SecurityGroup>} - A Promise of the security group information, or null if none exists
 */
exports.getSecurityGroup = function(groupName, vpcId) {
    let describeSgParams = {
            Filters: [
            {
                Name: 'vpc-id',
                Values: [vpcId]
            },
            {
                Name: 'group-name',
                Values: [groupName]
            }
        ]
    }
    return ec2.describeSecurityGroups(describeSgParams).promise()
        .then(describeResults => {
            if(describeResults['SecurityGroups'].length > 0) {
                return describeResults['SecurityGroups'][0];
            }
            else {
                return null;
            }
        });
}

exports.getSecurityGroupById = function(groupId, vpcId) {
    
}


//TODO - Document this
exports.tagResource = function(resourceId, tags) {
    var tagParams = {
        Resources: [
            resourceId
        ], 
        Tags: tags
    };
    return ec2.createTags(tagParams).promise();
}

exports.addIngressRuleToSgIfNotExists = function(sourceSg, destSg, 
                                                 protocol, startPort, 
                                                 endPort, vpcId) {

    return exports.getSecurityGroup(destSg['GroupName'], destSg['VpcId'])
        .then(securityGroup => {
            if(securityGroup) {
                let ingressRuleExists = false;
                for(let ingressRule of securityGroup['IpPermissions']) {
                    if(ingressRule['FromPort'] === startPort && ingressRule['ToPort'] === endPort && ingressRule['IpProtocol'] === protocol) {
                        for(let ingressRuleSource of ingressRule['UserIdGroupPairs']) {
                            if(ingressRuleSource['GroupId'] === sourceSg['GroupId']) {
                                ingressRuleExists = true;
                                break;
                            }
                        }
                    }
                }

                if(!ingressRuleExists) {
                    return exports.addIngressRuleToSecurityGroup(sourceSg, destSg, 
                                                                 protocol, startPort, 
                                                                 endPort, vpcId);
                }
                else {
                    return destSg;
                }
            }
            else {
                throw new Error("Bind failed - missing security group");
            }
        }); 
}


//TODO - Document this
exports.addIngressRuleToSecurityGroup = function(sourceSg, destSg, 
                                                 protocol, startPort, 
                                                 endPort, vpcId) {
    var addIngressParams = {
        GroupId: destSg['GroupId'],
        IpPermissions: [
            {
                IpProtocol: protocol,
                FromPort: startPort,
                ToPort: endPort,
                UserIdGroupPairs: [
                    {
                        GroupId: sourceSg['GroupId'],
                        VpcId: vpcId
                    }
                ]
            }
        ]
    };
    return ec2.authorizeSecurityGroupIngress(addIngressParams).promise()
        .then(authorizeResult => {
            return exports.getSecurityGroup(destSg['GroupName'], vpcId);    
        });
}