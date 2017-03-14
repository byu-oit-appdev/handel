const winston = require('winston');
const util = require('../util/util');
const BindContext = require('../datatypes/bind-context');

function getDependentServicesForCurrentBindService(environmentContext, toBindServiceName) {
    let dependentServices = [];
    for(let currentServiceName in environmentContext.serviceContexts) {
        let currentService = environmentContext.serviceContexts[currentServiceName];
        let currentServiceDeps = currentService.params.dependencies;
        if(currentServiceDeps && currentServiceDeps.includes(toBindServiceName)) {
            dependentServices.push(currentServiceName);
        }
    }
    return dependentServices;
}

exports.bindServicesInLevel = function(serviceDeployers, 
                                       environmentContext, 
                                       preDeployContexts, 
                                       deployOrder, 
                                       levelToBind) {
    let bindDeployPromises = [];
    let levelBindContexts = {};

    var currentLevelServicesToBind = deployOrder[levelToBind];
    winston.info(`Binding level ${levelToBind} of services: ${currentLevelServicesToBind.join(', ')}`);
    for(let i = 0; i < currentLevelServicesToBind.length; i++) {
        let toBindServiceName = currentLevelServicesToBind[i];

        //Get ServiceContext and PreDeployContext for the service to call bind on
        let toBindServiceContext = environmentContext.serviceContexts[toBindServiceName];
        let serviceDeployer = serviceDeployers[toBindServiceContext.serviceType];
        let toBindPreDeployContext = preDeployContexts[toBindServiceName];

        //This service may have multiple services dependening on it, run bind on each of them
        for(let dependentOfServiceName of getDependentServicesForCurrentBindService(environmentContext, toBindServiceName)) {
            //Get ServiceContext and PreDeployContext for the service dependency
            let dependentOfServiceContext = environmentContext.serviceContexts[dependentOfServiceName];
            let dependentOfPreDeployContext = preDeployContexts[dependentOfServiceName];

            //Run bind on the service combination
            let bindContextName = util.getBindContextName(toBindServiceName, dependentOfServiceName)
            winston.info(`Binding service ${bindContextName}`);
            let bindPromise = serviceDeployer.bind(toBindServiceContext, toBindPreDeployContext, dependentOfServiceContext, dependentOfPreDeployContext)
                .then(bindContext => {
                    if(!(bindContext instanceof BindContext)) {
                        throw new Error("Expected BindContext back from 'bind' phase of service deployer");
                    }
                    levelBindContexts[bindContextName] = bindContext;
                });
            bindDeployPromises.push(bindPromise);
        }
    }

    return Promise.all(bindDeployPromises)
        .then(() => {
            return levelBindContexts; //This was built up at each bind above
        });
}