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
    DeployContext,
    DeployOutputType,
    PreDeployContext,
    ServiceConfig,
    ServiceContext,
    ServiceDeployer,
    UnDeployContext
} from 'handel-extension-api';
import {
    awsCalls,
    checkPhase,
    deletePhases,
    deployPhase,
    handlebars,
    tagging
} from 'handel-extension-support';
import * as _ from 'lodash';
import * as path from 'path';
import * as winston from 'winston';
import * as util from '../../common/util';
import { HandlebarsStepFunctionsTemplate, StepFunctionsConfig } from './config-types';

const SERVICE_NAME = 'Step Functions';

function generateDefinitionString(filename: string, dependenciesDeployContexts: DeployContext[]): string {
    const readFile = path.extname(filename) === '.json' ? util.readJsonFileSync : util.readYamlFileSync;
    const definitionFile = readFile(filename);
    const dependencyArns: Map<string, string> = new Map();
    // Map service name to ARN
    for (const context of dependenciesDeployContexts) {
        dependencyArns.set(context.serviceName, context.eventOutputs!.resourceArn!);
    }
    // Change 'resource' in each state from service name to ARN
    _.values(definitionFile.States)
        .filter(state => state.hasOwnProperty('Resource'))
        .forEach((state: any) => state.Resource = dependencyArns.get(state.Resource));
    return JSON.stringify(definitionFile);
}

function getCompiledStepFunctionsTemplate(stackName: string, ownServiceContext: ServiceContext<StepFunctionsConfig>, dependenciesDeployContexts: DeployContext[]): Promise<string> {
    const definitionString = generateDefinitionString(ownServiceContext.params.definition, dependenciesDeployContexts);
    const policyStatements = deployPhase.getAllPolicyStatementsForServiceRole(ownServiceContext, [], dependenciesDeployContexts, false, false);
    const handlebarsParams: HandlebarsStepFunctionsTemplate = {
        stateMachineName: stackName,
        definitionString,
        policyStatements
    };
    const accountConfig = ownServiceContext.accountConfig;
    if (accountConfig.permissions_boundary) {
        handlebarsParams.permissionsBoundary = accountConfig.permissions_boundary
    }
    return handlebars.compileTemplate(`${__dirname}/stepfunctions-template.yml`, handlebarsParams);
}

function getDeployContext(serviceContext: ServiceContext<StepFunctionsConfig>, cfStack: AWS.CloudFormation.Stack): DeployContext {
    const deployContext = new DeployContext(serviceContext);
    const stateMachineArn = awsCalls.cloudFormation.getOutput('StateMachineArn', cfStack);
    const stateMachineName = awsCalls.cloudFormation.getOutput('StateMachineName', cfStack);
    if(!stateMachineArn || !stateMachineName) {
        throw new Error('Expected to receive state machine ARN and name from Step Functions service');
    }
    // Output policy for consuming this state machine
    deployContext.policies.push({
        'Effect': 'Allow',
        'Action': [
            'states:StartExecution',
            'states:StopExecution'
        ],
        'Resource': [
            stateMachineArn
        ]
    });

    // Inject env vars
    deployContext.addEnvironmentVariables({
        STATE_MACHINE_ARN: stateMachineArn,
        STATE_MACHINE_NAME: stateMachineName
    });

    return deployContext;
}

export class Service implements ServiceDeployer {
    public readonly producedDeployOutputTypes = [
        DeployOutputType.EnvironmentVariables,
        DeployOutputType.Policies
    ];
    public readonly consumedDeployOutputTypes = [
        DeployOutputType.EnvironmentVariables,
        DeployOutputType.Policies
    ];
    public readonly producedEventsSupportedTypes = [];
    public readonly providedEventType = null;
    public readonly supportsTagging = false;

    public check(serviceContext: ServiceContext<StepFunctionsConfig>, dependenciesServiceContexts: Array<ServiceContext<ServiceConfig>>): string[] {
        let definition: any;
        const errors: string[] = checkPhase.checkJsonSchema(`${__dirname}/params-schema.json`, serviceContext);

        // Check that definition is a valid JSON/YAML file
        if ('definition' in serviceContext.params && path.extname(serviceContext.params.definition) === '.json') {
            definition = util.readJsonFileSync(serviceContext.params.definition);
            if (definition === null) {
                errors.push(`${serviceContext.params.definition} is not a valid JSON file.`);
            }
        } else if ('definition' in serviceContext.params && ['.yml', '.yaml'].includes(path.extname(serviceContext.params.definition))) {
            definition = util.readYamlFileSync(serviceContext.params.definition);
            if (definition === null) {
                errors.push(`${serviceContext.params.definition} is not a valid YAML file.`);
            }
        }
        if (definition != null) {
            const start: string = definition.StartAt;
            const states: any = definition.States;
            const startIsString = typeof start === 'string';
            const statesIsObject = states instanceof Object;
            if (statesIsObject) {
                const dependencies: string[] = dependenciesServiceContexts.map(context => context.serviceName);
                for (const key in states) {
                    if (states.hasOwnProperty(key) && states[key].hasOwnProperty('Resource') && dependencies.indexOf(states[key].Resource) === -1) {
                        errors.push(`Service '${states[key].Resource}' not found in dependencies.`);
                    }
                }
            } else {
                errors.push(`States must be an object.`);
            }
            if (!startIsString) {
                errors.push(`StartAt must be a string.`);
            }
            if (startIsString && statesIsObject && !(start in states)) {
                errors.push(`Start state '${start}' does not exist`);
            }
        }

        return errors;
    }

    public async deploy(ownServiceContext: ServiceContext<StepFunctionsConfig>, ownPreDeployContext: PreDeployContext, dependenciesDeployContexts: DeployContext[]): Promise<DeployContext> {
        const stackName = ownServiceContext.stackName();
        winston.info(`${SERVICE_NAME} - Executing Deploy on '${stackName}'`);
        const compiledStepFunctionsTemplate = await getCompiledStepFunctionsTemplate(stackName, ownServiceContext, dependenciesDeployContexts);
        const stackTags = tagging.getTags(ownServiceContext);
        const deployedStack = await deployPhase.deployCloudFormationStack(ownServiceContext, stackName, compiledStepFunctionsTemplate, [], true, 30, stackTags);
        winston.info(`${SERVICE_NAME} - Finished deploying '${stackName}'`);
        return getDeployContext(ownServiceContext, deployedStack);
    }

    public async unDeploy(ownServiceContext: ServiceContext<StepFunctionsConfig>): Promise<UnDeployContext> {
        return deletePhases.unDeployService(ownServiceContext, SERVICE_NAME);
    }
}
