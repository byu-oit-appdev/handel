const accountConfig = require('../../../lib/util/account-config')(`${__dirname}/../../test-account-config.yml`).getAccountConfig();
const sqs = require('../../../lib/services/sqs');
const sqsCalls = require('../../../lib/aws/sqs-calls');
const cloudfFormationCalls = require('../../../lib/aws/cloudformation-calls');
const ServiceContext = require('../../../lib/datatypes/service-context');
const DeployContext = require('../../../lib/datatypes/deploy-context');
const ConsumeEventsContext = require('../../../lib/datatypes/consume-events-context');
const PreDeployContext = require('../../../lib/datatypes/pre-deploy-context');
const BindContext = require('../../../lib/datatypes/bind-context');
const sinon = require('sinon');
const expect = require('chai').expect;

describe('sqs deployer', function() {
    let sandbox;

    beforeEach(function() {
        sandbox = sinon.sandbox.create();
    });

    afterEach(function() {
        sandbox.restore();
    });

    describe('check', function() {
        it('shouldnt validate anything yet', function() {
            let serviceContext = new ServiceContext("FakeApp", "FakeEnv", "FakeService", "FakeType", "1", {});
            let errors = sqs.check(serviceContext);
            expect(errors).to.deep.equal([]);
        });
    });

    describe('preDeploy', function() {
        it('should return an empty predeploy context since it doesnt do anything', function() {
            let serviceContext = new ServiceContext("FakeApp", "FakeEnv", "FakeService", "FakeType", "1", {});
            return sqs.preDeploy(serviceContext)
                .then(preDeployContext => {
                    expect(preDeployContext).to.be.instanceof(PreDeployContext);
                    expect(preDeployContext.appName).to.equal(serviceContext.appName);
                });
        });
    });

    describe('getPreDeployContextForExternalRef', function() {
        it('should return an empty preDeployContext', function() {
            let externalRefServiceContext = new ServiceContext("FakeName", "FakeEnv", "FakeService", "FakeType", "1", {});
            return sqs.getPreDeployContextForExternalRef(externalRefServiceContext)
                .then(externalRefPreDeployContext => {
                    expect(externalRefPreDeployContext).to.be.instanceof(PreDeployContext);
                });
        })
    });

    describe('bind', function() {
        it('should return an empty bind context since it doesnt do anything', function() {
            let serviceContext = new ServiceContext("FakeApp", "FakeEnv", "FakeService", "FakeType", "1", {});
            return sqs.bind(serviceContext)
                .then(bindContext => {
                    expect(bindContext).to.be.instanceof(BindContext);
                    expect(bindContext.dependencyServiceContext.appName).to.equal(serviceContext.appName);
                });
        });
    });

    describe('getBindContextForExternalRef', function() {
        it('should return an empty bind context', function() {
            return sqs.getBindContextForExternalRef(null, null, null, null)
                .then(externalBindContext => {
                    expect(externalBindContext).to.be.instanceof(BindContext);
                });
        });
    });

    describe('deploy', function() {
        it('should create a new queue when the stack doesnt exist', function() {
            let appName = "FakeApp";
            let envName = "FakeEnv";
            let serviceName = "FakeService";
            let serviceType = "sqs";
            let queueName = "FakeQueue";
            let queueArn = "FakeArn";
            let queueUrl = "FakeUrl";

            let getStackStub = sandbox.stub(cloudfFormationCalls, 'getStack').returns(Promise.resolve(null));
            let createStackStub = sandbox.stub(cloudfFormationCalls, 'createStack').returns(Promise.resolve({
                Outputs: [
                    {
                        OutputKey: 'QueueName',
                        OutputValue: queueName
                    },
                    {
                        OutputKey: 'QueueArn',
                        OutputValue: queueArn
                    },
                    {
                        OutputKey: 'QueueUrl',
                        OutputValue: queueUrl
                    }
                ]
            }));

            let ownServiceContext = new ServiceContext(appName, envName, serviceName, serviceType, "1", {
                type: 'sqs',
                queue_type: 'fifo',
                content_based_deduplication: true,
                delay_seconds: 2,
                max_message_size: 262140,
                message_retention_period: 345601,
                visibility_timeout: 40
            });
            let ownPreDeployContext = new PreDeployContext(ownServiceContext);

            return sqs.deploy(ownServiceContext, ownPreDeployContext, [])
                .then(deployContext => {
                    expect(getStackStub.calledOnce).to.be.true;
                    expect(createStackStub.calledOnce).to.be.true;

                    expect(deployContext).to.be.instanceof(DeployContext);

                    //Should have exported 3 env vars
                    let queueNameEnv = `${serviceType}_${appName}_${envName}_${serviceName}_QUEUE_NAME`.toUpperCase()
                    expect(deployContext.environmentVariables[queueNameEnv]).to.equal(queueName);
                    let queueUrlEnv = `${serviceType}_${appName}_${envName}_${serviceName}_QUEUE_URL`.toUpperCase()
                    expect(deployContext.environmentVariables[queueUrlEnv]).to.equal(queueUrl);
                    let queueArnEnv = `${serviceType}_${appName}_${envName}_${serviceName}_QUEUE_ARN`.toUpperCase()
                    expect(deployContext.environmentVariables[queueArnEnv]).to.equal(queueArn);

                    //Should have exported 1 policy
                    expect(deployContext.policies.length).to.equal(1); //Should have exported one policy
                    expect(deployContext.policies[0].Resource[0]).to.equal(queueArn);
                });
        });

        it('should update the stack when the queue already exists', function() {
            let appName = "FakeApp";
            let envName = "FakeEnv";
            let serviceName = "FakeService";
            let serviceType = "sqs";
            let queueName = "FakeQueue";
            let queueArn = "FakeArn";
            let queueUrl = "FakeUrl";

            let getStackStub = sandbox.stub(cloudfFormationCalls, 'getStack').returns(Promise.resolve({}));
            let updateStackStub = sandbox.stub(cloudfFormationCalls, 'updateStack').returns(Promise.resolve({
                Outputs: [
                    {
                        OutputKey: 'QueueName',
                        OutputValue: queueName
                    },
                    {
                        OutputKey: 'QueueArn',
                        OutputValue: queueArn
                    },
                    {
                        OutputKey: 'QueueUrl',
                        OutputValue: queueUrl
                    }
                ]
            }));

            let ownServiceContext = new ServiceContext(appName, envName, serviceName, serviceType, "1", {
                type: 'sqs',
                queue_type: 'fifo',
                content_based_deduplication: true,
                delay_seconds: 2,
                max_message_size: 262140,
                message_retention_period: 345601,
                visibility_timeout: 40
            });
            let ownPreDeployContext = new PreDeployContext(ownServiceContext);

            return sqs.deploy(ownServiceContext, ownPreDeployContext, [])
                .then(deployContext => {
                    expect(getStackStub.calledOnce).to.be.true;
                    expect(updateStackStub.calledOnce).to.be.true;

                    expect(deployContext).to.be.instanceof(DeployContext);

                    //Should have exported 3 env vars
                    let queueNameEnv = `${serviceType}_${appName}_${envName}_${serviceName}_QUEUE_NAME`.toUpperCase()
                    expect(deployContext.environmentVariables[queueNameEnv]).to.equal(queueName);
                    let queueUrlEnv = `${serviceType}_${appName}_${envName}_${serviceName}_QUEUE_URL`.toUpperCase()
                    expect(deployContext.environmentVariables[queueUrlEnv]).to.equal(queueUrl);
                    let queueArnEnv = `${serviceType}_${appName}_${envName}_${serviceName}_QUEUE_ARN`.toUpperCase()
                    expect(deployContext.environmentVariables[queueArnEnv]).to.equal(queueArn);

                    //Should have exported 1 policy
                    expect(deployContext.policies.length).to.equal(1); //Should have exported one policy
                    expect(deployContext.policies[0].Resource[0]).to.equal(queueArn);
                });
        });
    });

    describe('getDeployContextForExternalRef', function() {
        it('should return a DeployContext if the service has been deployed', function() {
            let getStackStub = sandbox.stub(cloudfFormationCalls, 'getStack').returns(Promise.resolve({
                Outputs: [
                    {
                        OutputKey: 'QueueName',
                        OutputValue: 'FakeName'
                    },
                    {
                        OutputKey: 'QueueArn',
                        OutputValue: 'FakeQueueArn'
                    },
                    {
                        OutputKey: 'QueueUrl',
                        OutputValue: 'FakeQueueURl'
                    }
                ]
            }));
            let externalServiceContext = new ServiceContext("FakeApp", "FakeEnv", "FakeService", "dynamodb", "1", {});            
            return sqs.getDeployContextForExternalRef(externalServiceContext)
                .then(externalDeployContext => {
                    expect(getStackStub.calledOnce).to.be.true;
                    expect(externalDeployContext).to.be.instanceof(DeployContext);
                });
        });

        it('should return an error if the service hasnt been deployed yet', function() {
            let getStackStub = sandbox.stub(cloudfFormationCalls, 'getStack').returns(Promise.resolve(null));
            let externalServiceContext = new ServiceContext("FakeApp", "FakeEnv", "FakeService", "dynamodb", "1", {});            
            return sqs.getDeployContextForExternalRef(externalServiceContext)
                .then(externalDeployContext => {
                    expect(true).to.equal(false); //Should not get here
                })
                .catch(err => {
                    expect(err.message).to.contain('You must deploy it independently');
                    expect(getStackStub.calledOnce).to.be.true;
                });
        });
    });

    describe('consumeEvents', function() {
        it('should throw an error because SQS cant consume event services', function() {
            let appName = "FakeApp";
            let envName = "FakeEnv";
            let deployVersion = "1";
            let consumerServiceContext = new ServiceContext(appName, envName, "ConsumerService", "sqs", deployVersion, {});
            let consumerDeployContext = new DeployContext(consumerServiceContext);
            consumerDeployContext.eventOutputs.queueUrl = "FakeQueueUrl";
            consumerDeployContext.eventOutputs.queueArn = "FakeQueueArn";

            let producerServiceContext = new ServiceContext(appName, envName, "ProducerService", "sns", deployVersion, {});
            let producerDeployContext = new DeployContext(producerServiceContext);
            producerDeployContext.eventOutputs.topicArn = "FakeTopicArn";

            let addSqsPermissionStub = sandbox.stub(sqsCalls, 'addSqsPermissionIfNotExists').returns(Promise.resolve({}));

            return sqs.consumeEvents(consumerServiceContext, consumerDeployContext, producerServiceContext, producerDeployContext)
                .then(consumeEventsContext => {
                    expect(addSqsPermissionStub.calledOnce).to.be.true;
                    expect(consumeEventsContext).to.be.instanceOf(ConsumeEventsContext);
                });
        });
    });

    describe('getConsumeEventsContextForExternalRef', function() {
        it('should return the ConsumeEventsContext when consumeEvents has been run already', function() {
            let appName = "FakeApp";
            let envName = "FakeEnv";
            let deployVersion = "1";
            let consumerServiceContext = new ServiceContext(appName, envName, "ConsumerService", "sqs", deployVersion, {});
            let consumerDeployContext = new DeployContext(consumerServiceContext);
            consumerDeployContext.eventOutputs.queueUrl = "FakeQueueUrl";
            consumerDeployContext.eventOutputs.queueArn = "FakeQueueArn";

            let producerServiceContext = new ServiceContext(appName, envName, "ProducerService", "sns", deployVersion, {});
            let producerDeployContext = new DeployContext(producerServiceContext);
            producerDeployContext.eventOutputs.topicArn = "FakeTopicArn";

            let getSqsPermissionStub = sandbox.stub(sqsCalls, 'getSqsPermission').returns(Promise.resolve({}));

            return sqs.getConsumeEventsContextForExternalRef(consumerServiceContext, consumerDeployContext, producerServiceContext, producerDeployContext)
                .then(externalConsumeEventsContext => {
                    expect(getSqsPermissionStub.calledOnce).to.be.true;
                    expect(externalConsumeEventsContext).to.be.instanceOf(ConsumeEventsContext);
                });
        });

        it('should return an error when consumeEvents has not been run', function() {
            let appName = "FakeApp";
            let envName = "FakeEnv";
            let deployVersion = "1";
            let consumerServiceContext = new ServiceContext(appName, envName, "ConsumerService", "sqs", deployVersion, {});
            let consumerDeployContext = new DeployContext(consumerServiceContext);
            consumerDeployContext.eventOutputs.queueUrl = "FakeQueueUrl";
            consumerDeployContext.eventOutputs.queueArn = "FakeQueueArn";

            let producerServiceContext = new ServiceContext(appName, envName, "ProducerService", "sns", deployVersion, {});
            let producerDeployContext = new DeployContext(producerServiceContext);
            producerDeployContext.eventOutputs.topicArn = "FakeTopicArn";

            let getSqsPermissionStub = sandbox.stub(sqsCalls, 'getSqsPermission').returns(Promise.resolve(null));

            return sqs.getConsumeEventsContextForExternalRef(consumerServiceContext, consumerDeployContext, producerServiceContext, producerDeployContext)
                .then(externalConsumeEventsContext => {
                    expect(true).to.be.false;
                })
                .catch(err => {
                    expect(getSqsPermissionStub.calledOnce).to.be.true;
                    expect(err.message).to.contain('ConsumeEvents not run for external service');
                });
        });
    });

    describe('produceEvents', function() {
        it('should throw an error because SQS cant produce events for other services', function() {
            return sqs.produceEvents(null, null, null, null)
                .then(produceEventsContext => {
                    expect(true).to.be.false; //Shouldnt get here
                })
                .catch(err => {
                    expect(err.message).to.contain("SQS service doesn't produce events");
                });
        });
    });
});