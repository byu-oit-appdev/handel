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
import { ServiceConfig } from 'handel-extension-api';
 export interface AmazonMQServiceConfig extends ServiceConfig {
    instance_type?: string;
    multi_az?: boolean;
    general_logging?: boolean;
    audit_logging?: boolean;
    configuration?: string;
}
 export interface HandlebarsAmazonMQTemplate {
    brokerName: string;
    engineType: string;
    engineVersion: string;
    instanceType: string;
    generalLogging: boolean;
    auditLogging: boolean;
    securityGroupId: string;
    subnetId1: string;
    subnetId2?: string;
    configurationBase64EncodedXml?: string;
}
