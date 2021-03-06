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
import {
    BindContext,
    DeployContext,
    DeployOutputType,
    PreDeployContext,
    ServiceConfig,
    ServiceContext,
    ServiceDeployer,
    UnBindContext,
    UnDeployContext,
    UnPreDeployContext
} from 'handel-extension-api';
import {
    awsCalls,
    bindPhase,
    checkPhase,
    deletePhases,
    deployPhase,
    handlebars,
    preDeployPhase,
    tagging
} from 'handel-extension-support';
import * as winston from 'winston';
import * as elasticacheDeployersCommon from '../../common/elasticache-deployers-common';
import { HandlebarsRedisTemplate, RedisServiceConfig } from './config-types';

const SERVICE_NAME = 'Redis';
const REDIS_PORT = 6379;
const REDIS_SG_PROTOCOL = 'tcp';

function getDeployContext(serviceContext: ServiceContext<RedisServiceConfig>, cfStack: AWS.CloudFormation.Stack): DeployContext {
    const deployContext = new DeployContext(serviceContext);

    // Set port and address environment variables
    const port = awsCalls.cloudFormation.getOutput('CachePort', cfStack);
    const address = awsCalls.cloudFormation.getOutput('CacheAddress', cfStack);
    if(!port || !address) {
        throw new Error('Expected to receive port and address back from Redis service');
    }

    deployContext.addEnvironmentVariables({
        PORT: port,
        ADDRESS: address
    });
    return deployContext;
}

function getCacheParameterGroupFamily(redisVersion: string): string {
    if (redisVersion.startsWith('2.6')) {
        return 'redis2.6';
    }
    else if (redisVersion.startsWith('2.8')) {
        return 'redis2.8';
    }
    else if (redisVersion.startsWith('3.2')) {
        return 'redis3.2';
    }
    else if (redisVersion.startsWith('4.0')) {
        return 'redis4.0';
    }
    else if (redisVersion.startsWith('5.0')) {
        return 'redis5.0';
    }
    else {
        throw new Error(`Unsupported Redis major/minor version: '${redisVersion}'`);
    }
}

function getDefaultCacheParameterGroup(redisVersion: string): string {
    if (redisVersion.startsWith('2.6')) {
        return 'default.redis2.6';
    }
    else if (redisVersion.startsWith('2.8')) {
        return 'default.redis2.8';
    }
    // else if(redisVersion.startsWith('3.2') && numShards > 1) {
    //     return 'default.redis3.2.cluster.on';
    // }
    else if (redisVersion.startsWith('3.2')) {
        return 'default.redis3.2';
    }
    else if (redisVersion.startsWith('4.0')) {
        return 'default.redis4.0';
    }
    else if (redisVersion.startsWith('5.0')) {
        return 'default.redis5.0';
    }
    else {
        throw new Error(`Unsupported Redis major/minor version: '${redisVersion}'`);
    }
}

function getCompiledRedisTemplate(stackName: string, ownServiceContext: ServiceContext<RedisServiceConfig>, ownPreDeployContext: PreDeployContext): Promise<string> {
    const serviceParams = ownServiceContext.params;
    const accountConfig = ownServiceContext.accountConfig;

    const clusterName = elasticacheDeployersCommon.getClusterName(ownServiceContext);
    const description = serviceParams.description || `Parameter group for ${clusterName}`;
    const redisVersion = serviceParams.redis_version;
    // let shards = serviceParams.shards || 1;
    const readReplicas = serviceParams.read_replicas || 0;

    const handlebarsParams: HandlebarsRedisTemplate = {
        description: description,
        instanceType: serviceParams.instance_type,
        cacheSubnetGroup: accountConfig.elasticache_subnet_group,
        redisVersion,
        stackName,
        clusterName,
        maintenanceWindow: serviceParams.maintenance_window,
        redisSecurityGroupId: ownPreDeployContext.securityGroups[0].GroupId!,
        snapshotWindow: serviceParams.snapshot_window,
        // shards,
        numNodes: readReplicas + 1,
        tags: tagging.getTags(ownServiceContext)
    };

    // Either create custom parameter group if params are specified, or just use default
    if (serviceParams.cache_parameters) {
        handlebarsParams.cacheParameters = serviceParams.cache_parameters;
        handlebarsParams.cacheParameterGroupFamily = getCacheParameterGroupFamily(redisVersion);
    }
    else {
        handlebarsParams.defaultCacheParameterGroup = getDefaultCacheParameterGroup(redisVersion);
    }

    // if(shards === 1) { //Cluster mode disabled
    if (readReplicas === 0) { // No replication group
        return handlebars.compileTemplate(`${__dirname}/redis-single-no-repl-template.yml`, handlebarsParams);
    }
    else { // Replication group
        return handlebars.compileTemplate(`${__dirname}/redis-single-repl-template.yml`, handlebarsParams);
    }
    // }
    // else { //Cluster mode enabled (includes replication group)
    //     return handlebarsUtils.compileTemplate(`${__dirname}/redis-cluster-template.yml`, handlebarsParams);
    // }
}

export class Service implements ServiceDeployer {
    public readonly producedDeployOutputTypes = [
        DeployOutputType.EnvironmentVariables,
        DeployOutputType.SecurityGroups
    ];
    public readonly consumedDeployOutputTypes = [];
    public readonly producedEventsSupportedTypes = [];
    public readonly providedEventType = null;
    public readonly supportsTagging = true;

    public check(serviceContext: ServiceContext<RedisServiceConfig>, dependenciesServiceContexts: Array<ServiceContext<ServiceConfig>>): string[] {
        const errors: string[] = checkPhase.checkJsonSchema(`${__dirname}/params-schema.json`, serviceContext);
        const serviceParams = serviceContext.params;

        if (serviceParams.read_replicas) {
            if (serviceParams.read_replicas > 0 && (serviceParams.instance_type.includes('t2') || serviceParams.instance_type.includes('t1'))) {
                errors.push(`You may not use the 't1' and 't2' instance types when using any read replicas`);
            }
        }
        // if(serviceParams.num_shards) {
        //     if(serviceParams.num_shards < 1 || serviceParams.num_shards > 15) {
        //         errors.push(`${SERVICE_NAME} - The 'num_shards' parameter may only have a value of 1-15`);
        //     }
        //     if(serviceParams.num_shards > 1 && (serviceParams.redis_version.includes("2.6") || serviceParams.redis_version.includes('2.8'))) { //Cluster mode enabled
        //         errors.push(`${SERVICE_NAME} - You may not use cluster mode (num_shards > 1) unless you are using version 3.2 or higher`);
        //     }
        // }

        return errors;
    }

    public async preDeploy(serviceContext: ServiceContext<RedisServiceConfig>): Promise<PreDeployContext> {
        return preDeployPhase.preDeployCreateSecurityGroup(serviceContext, null, SERVICE_NAME);
    }

    public async getPreDeployContext(serviceContext: ServiceContext<RedisServiceConfig>): Promise<PreDeployContext> {
        return preDeployPhase.getSecurityGroup(serviceContext);
    }

    public async bind(ownServiceContext: ServiceContext<RedisServiceConfig>, ownPreDeployContext: PreDeployContext, dependentOfServiceContext: ServiceContext<ServiceConfig>, dependentOfPreDeployContext: PreDeployContext): Promise<BindContext> {
        return bindPhase.bindDependentSecurityGroup(ownServiceContext, ownPreDeployContext, dependentOfServiceContext, dependentOfPreDeployContext, REDIS_SG_PROTOCOL, REDIS_PORT);
    }

    public async deploy(ownServiceContext: ServiceContext<RedisServiceConfig>, ownPreDeployContext: PreDeployContext, dependenciesDeployContexts: DeployContext[]): Promise<DeployContext> {
        const stackName = ownServiceContext.stackName();
        winston.info(`${SERVICE_NAME} - Deploying cluster '${stackName}'`);
        const compiledTemplate = await getCompiledRedisTemplate(stackName, ownServiceContext, ownPreDeployContext);
        const stackTags = tagging.getTags(ownServiceContext);
        const deployedStack = await deployPhase.deployCloudFormationStack(ownServiceContext, stackName, compiledTemplate, [], true, 30, stackTags);
        winston.info(`${SERVICE_NAME} - Finished deploying cluster '${stackName}'`);
        return getDeployContext(ownServiceContext, deployedStack);
    }

    public async unPreDeploy(ownServiceContext: ServiceContext<RedisServiceConfig>): Promise<UnPreDeployContext> {
        return deletePhases.unPreDeploySecurityGroup(ownServiceContext, SERVICE_NAME);
    }

    public async unBind(ownServiceContext: ServiceContext<RedisServiceConfig>, ownPreDeployContext: PreDeployContext, dependentOfServiceContext: ServiceContext<ServiceConfig>, dependentOfPreDeployContext: PreDeployContext): Promise<UnBindContext> {
        return deletePhases.unBindService(ownServiceContext, ownPreDeployContext, dependentOfServiceContext, dependentOfPreDeployContext, REDIS_SG_PROTOCOL, REDIS_PORT);
    }

    public async unDeploy(ownServiceContext: ServiceContext<RedisServiceConfig>): Promise<UnDeployContext> {
        return deletePhases.unDeployService(ownServiceContext, SERVICE_NAME);
    }
}
