/*
 * Copyright 2018 Brigham Young University
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 */
import { expect } from 'chai';
import {
    AccountConfig,
    BindContext,
    DeployContext,
    PreDeployContext,
    ServiceContext,
    ServiceDeployer,
    ServiceType,
    UnBindContext,
    UnDeployContext,
    UnPreDeployContext
} from 'handel-extension-api';
import { awsCalls, bindPhase, deletePhases, deployPhase, preDeployPhase } from 'handel-extension-support';
import 'mocha';
import * as sinon from 'sinon';
import config from '../../../src/account-config/account-config';
import { Service } from '../../../src/services/mysql';
import { MySQLConfig } from '../../../src/services/mysql/config-types';
import { STDLIB_PREFIX } from '../../../src/services/stdlib';

describe('mysql deployer', () => {
    let sandbox: sinon.SinonSandbox;
    const appName = 'FakeApp';
    const envName = 'FakeEnv';
    let serviceContext: ServiceContext<MySQLConfig>;
    let serviceParams: MySQLConfig;
    let accountConfig: AccountConfig;
    let mysql: ServiceDeployer;

    beforeEach(async () => {
        mysql = new Service();
        accountConfig = await config(`${__dirname}/../../test-account-config.yml`);
        sandbox = sinon.createSandbox();
        serviceParams = {
            type: 'mysql',
            mysql_version: '5.6.27',
            database_name: 'mydb'
        };
        serviceContext = new ServiceContext(appName, envName, 'FakeService', new ServiceType(STDLIB_PREFIX, 'mysql'), serviceParams, accountConfig);
    });

    afterEach(() => {
        sandbox.restore();
    });

    describe('check', () => {
        it('should require the database_name parameter', () => {
            delete serviceContext.params.database_name;
            const errors = mysql.check!(serviceContext, []);
            expect(errors.length).to.equal(1);
            expect(errors[0]).to.contain(`'database_name' parameter is required`);
        });

        it('should require the mysql_version parameter', () => {
            delete serviceContext.params.mysql_version;
            const errors = mysql.check!(serviceContext, []);
            expect(errors.length).to.equal(1);
            expect(errors[0]).to.contain(`'mysql_version' parameter is required`);
        });

        it('should work when all required parameters are provided properly', () => {
            const errors = mysql.check!(serviceContext, []);
            expect(errors.length).to.equal(0);
        });
    });

    describe('preDeploy', () => {
        it('should create a security group', async () => {
            const groupId = 'FakeSgGroupId';
            const preDeployContext = new PreDeployContext(serviceContext);
            preDeployContext.securityGroups.push({
                GroupId: groupId
            });
            const createSgStub = sandbox.stub(preDeployPhase, 'preDeployCreateSecurityGroup')
                .resolves(preDeployContext);

            const retPreDeployContext = await mysql.preDeploy!(serviceContext);
            expect(retPreDeployContext).to.be.instanceof(PreDeployContext);
            expect(retPreDeployContext.securityGroups.length).to.equal(1);
            expect(retPreDeployContext.securityGroups[0].GroupId).to.equal(groupId);
            expect(createSgStub.callCount).to.equal(1);
        });
    });

    describe('bind', () => {
        it('should add the source sg to its own sg as an ingress rule', async () => {
            const dependencyServiceContext = new ServiceContext(appName, envName, 'FakeService', new ServiceType(STDLIB_PREFIX, 'postgresql'), serviceParams, accountConfig);
            const dependencyPreDeployContext = new PreDeployContext(dependencyServiceContext);
            const dependentOfServiceContext = new ServiceContext(appName, envName, 'FakeService', new ServiceType(STDLIB_PREFIX, 'beanstalk'), {type: 'beanstalk'}, accountConfig);
            const dependentOfPreDeployContext = new PreDeployContext(dependentOfServiceContext);
            const bindSgStub = sandbox.stub(bindPhase, 'bindDependentSecurityGroup')
                .resolves(new BindContext(dependencyServiceContext, dependentOfServiceContext));

            const bindContext = await mysql.bind!(dependencyServiceContext, dependencyPreDeployContext,
                dependentOfServiceContext, dependentOfPreDeployContext);
            expect(bindContext).to.be.instanceof(BindContext);
            expect(bindSgStub.callCount).to.equal(1);
        });
    });

    describe('deploy', () => {
        const envPrefix = 'FAKESERVICE';
        const databaseAddress = 'fakeaddress.amazonaws.com';
        const databasePort = 3306;
        const databaseName = 'mydb';
        let ownPreDeployContext: PreDeployContext;
        let dependenciesDeployContexts: DeployContext[];
        const deployedStack = {
            Outputs: [
                {
                    OutputKey: 'DatabaseAddress',
                    OutputValue: databaseAddress
                },
                {
                    OutputKey: 'DatabasePort',
                    OutputValue: databasePort
                },
                {
                    OutputKey: 'DatabaseName',
                    OutputValue: databaseName
                }
            ]
        };

        beforeEach(() => {
            ownPreDeployContext = new PreDeployContext(serviceContext);
            ownPreDeployContext.securityGroups.push({
                GroupId: 'FakeId'
            });

            dependenciesDeployContexts = [];
        });

        it('should create the cluster if it doesnt exist', async () => {
            const getStackStub = sandbox.stub(awsCalls.cloudFormation, 'getStack').resolves(null);
            const createStackStub = sandbox.stub(awsCalls.cloudFormation, 'createStack')
                .resolves(deployedStack);
            const addCredentialsStub = sandbox.stub(deployPhase, 'addItemToSSMParameterStore')
                .resolves(deployedStack);

            const deployContext = await mysql.deploy!(serviceContext, ownPreDeployContext, dependenciesDeployContexts);
            expect(getStackStub.callCount).to.equal(1);
            expect(createStackStub.callCount).to.equal(1);
            expect(addCredentialsStub.callCount).to.equal(2);
            expect(deployContext).to.be.instanceof(DeployContext);
            expect(deployContext.environmentVariables[`${envPrefix}_ADDRESS`]).to.equal(databaseAddress);
            expect(deployContext.environmentVariables[`${envPrefix}_PORT`]).to.equal(databasePort);
            expect(deployContext.environmentVariables[`${envPrefix}_DATABASE_NAME`]).to.equal(databaseName);
        });

        it('should not update the database if it already exists', async () => {
            const getStackStub = sandbox.stub(awsCalls.cloudFormation, 'getStack').resolves(deployedStack);
            const updateStackStub = sandbox.stub(awsCalls.cloudFormation, 'updateStack').resolves(null);

            const deployContext = await mysql.deploy!(serviceContext, ownPreDeployContext, dependenciesDeployContexts);
            expect(getStackStub.callCount).to.equal(1);
            expect(updateStackStub.callCount).to.equal(0);
            expect(deployContext).to.be.instanceof(DeployContext);
            expect(deployContext.environmentVariables[`${envPrefix}_ADDRESS`]).to.equal(databaseAddress);
            expect(deployContext.environmentVariables[`${envPrefix}_PORT`]).to.equal(databasePort);
            expect(deployContext.environmentVariables[`${envPrefix}_DATABASE_NAME`]).to.equal(databaseName);
        });
    });

    describe('unPreDeploy', () => {
        it('should delete the security group', async () => {
            const unPreDeployStub = sandbox.stub(deletePhases, 'unPreDeploySecurityGroup')
                .resolves(new UnPreDeployContext(serviceContext));

            const unPreDeployContext = await mysql.unPreDeploy!(serviceContext);
            expect(unPreDeployContext).to.be.instanceof(UnPreDeployContext);
            expect(unPreDeployStub.callCount).to.equal(1);
        });
    });

    describe('unBind', () => {
        it('should unbind the security group', async () => {
            const dependencyPreDeployContext = new PreDeployContext(serviceContext);
            const dependentOfServiceContext = new ServiceContext(appName, envName, 'FakeService', new ServiceType(STDLIB_PREFIX, 'beanstalk'), {type: 'beanstalk'}, accountConfig);
            const dependentOfPreDeployContext = new PreDeployContext(dependentOfServiceContext);
            const unBindStub = sandbox.stub(deletePhases, 'unBindService').resolves(new UnBindContext(serviceContext, dependentOfServiceContext));

            const unBindContext = await mysql.unBind!(serviceContext, dependencyPreDeployContext, dependentOfServiceContext, dependentOfPreDeployContext);
            expect(unBindContext).to.be.instanceof(UnBindContext);
            expect(unBindStub.callCount).to.equal(1);
        });
    });

    describe('unDeploy', () => {
        it('should undeploy the stack', async () => {
            const unDeployStackStub = sandbox.stub(deletePhases, 'unDeployService')
                .resolves(new UnDeployContext(serviceContext));
            const deleteParametersStub = sandbox.stub(deletePhases, 'deleteServiceItemsFromSSMParameterStore').resolves({});

            const unDeployContext = await mysql.unDeploy!(serviceContext);
            expect(unDeployContext).to.be.instanceof(UnDeployContext);
            expect(unDeployStackStub.callCount).to.equal(1);
            expect(deleteParametersStub.callCount).to.equal(1);
        });
    });
});
