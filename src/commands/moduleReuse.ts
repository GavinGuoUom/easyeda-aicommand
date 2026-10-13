import type { ICommandDef } from '../engine/types';

const MODULE_REUSE_RPC_TOPIC = 'module-reuse:rpc:v1';
const MODULE_REUSE_PLUGIN = 'module-reuse';
const REMOTE_PLUGIN_FAILURE = Symbol('moduleReuseRemotePluginFailure');

type ModuleReuseOperation = 'getStatus' | 'getContext' | 'capturePair' | 'probeNativeCopy' | 'getCopyOperation' | 'restoreFile' | 'getRestoreOperation' | 'exportTemplateFile' | 'placeSchematicPage' | 'alignTemplatePcb' | 'mapInstanceNets' | 'getPlacementOperation' | 'importPcbInstances' | 'getPcbImportOperation';

function requireNonEmptyString(value: unknown, name: string): string {
	if (typeof value !== 'string' || value.length === 0)
		throw new Error(`${name} 必须是非空字符串`);
	return value;
}

async function readTargetIds(): Promise<{ projectUuid: string; documentUuid: string }> {
	const project: any = await eda.dmt_Project.getCurrentProjectInfo();
	const document: any = await eda.dmt_SelectControl.getCurrentDocumentInfo();
	return {
		projectUuid: requireNonEmptyString(project?.uuid, '当前工程 UUID'),
		documentUuid: requireNonEmptyString(document?.uuid, '当前文档 UUID'),
	};
}

function assertRequestedTarget(
	actual: { projectUuid: string; documentUuid: string },
	expected: { projectUuid: string; documentUuid: string },
	phase: string,
): void {
	if (actual.projectUuid !== expected.projectUuid)
		throw new Error(`${phase}工程已切换：请求 ${expected.projectUuid}，当前 ${actual.projectUuid}`);
	if (actual.documentUuid !== expected.documentUuid)
		throw new Error(`${phase}文档已切换：请求 ${expected.documentUuid}，当前 ${actual.documentUuid}`);
}

function validateReply(reply: any): unknown {
	if (!reply || typeof reply !== 'object' || Array.isArray(reply))
		throw new Error('module-reuse RPC 协议错误：响应必须是对象');
	if (reply.protocol !== 1)
		throw new Error('module-reuse RPC 协议错误：protocol 必须为 1');
	if (reply.plugin !== MODULE_REUSE_PLUGIN)
		throw new Error(`module-reuse RPC 插件错误：期望 ${MODULE_REUSE_PLUGIN}`);
	if (typeof reply.ok !== 'boolean')
		throw new Error('module-reuse RPC 协议错误：ok 必须是布尔值');
	if (!reply.ok) {
		if (!reply.error || typeof reply.error !== 'object' || typeof reply.error.message !== 'string' || reply.error.message.length === 0)
			throw new Error('module-reuse RPC 协议错误：失败响应缺少 error.message');
		const error = new Error(`module-reuse 插件拒绝请求：${reply.error.message}`, { cause: reply.error.cause });
		(error as any)[REMOTE_PLUGIN_FAILURE] = true;
		throw error;
	}
	if (!Object.prototype.hasOwnProperty.call(reply, 'data') || reply.data === undefined)
		throw new Error('module-reuse RPC 协议错误：成功响应缺少 data');
	return reply.data;
}

async function callModuleReuse(operation: ModuleReuseOperation, params: Record<string, unknown> = {}): Promise<unknown> {
	const reply = await eda.sys_MessageBus.rpcCallPublic(MODULE_REUSE_RPC_TOPIC, {
		protocol: 1,
		operation,
		params,
	});
	return validateReply(reply);
}

function unknownCopyError(error: unknown, operationId: string, phase: string, createdUuid?: string): Error {
	if (error instanceof Error && (error as any)[REMOTE_PLUGIN_FAILURE] === true) {
		if ((error as any).cause?.partial === false || (error as any).cause?.partial === true)
			return error;
	}
	const detail = error instanceof Error ? error.message : String(error);
	return new Error(`原生复制结果未知（operationId=${operationId}）：${detail}`, {
		cause: {
			partial: true,
			retryable: false,
			outcome: 'unknown',
			operationId,
			phase,
			...(createdUuid ? { createdUuid } : {}),
			error: detail,
		},
	});
}

async function currentProjectUuid(): Promise<string> {
	const project: any = await eda.dmt_Project.getCurrentProjectInfo();
	return requireNonEmptyString(project?.uuid, '当前工程 UUID');
}

function validateCapturePairData(data: any, params: { projectUuid: string; schematicPageUuid: string; pcbUuid: string }): any {
	if (!data || typeof data !== 'object' || Array.isArray(data)
		|| typeof data.captureId !== 'string' || data.captureId.length === 0
		|| !data.source || typeof data.source !== 'object' || Array.isArray(data.source)
		|| !data.documents || typeof data.documents !== 'object' || Array.isArray(data.documents)) {
		throw new Error('module.capturePair 插件数据错误：缺少 captureId、source 或 documents');
	}
	if (data.source.projectUuid !== params.projectUuid
		|| data.source.schematicPageUuid !== params.schematicPageUuid
		|| data.source.pcbUuid !== params.pcbUuid) {
		throw new Error('module.capturePair 插件数据错误：来源身份与请求不匹配');
	}
	for (const [key, expectedUuid] of [['schematic', params.schematicPageUuid], ['pcb', params.pcbUuid]]) {
		const document = data.documents[key];
		if (!document || typeof document !== 'object' || Array.isArray(document)
			|| document.uuid !== expectedUuid || typeof document.docType !== 'string'
			|| typeof document.validObjectCount !== 'number') {
			throw new Error(`module.capturePair 插件数据错误：${key} 文档摘要不完整或身份不匹配`);
		}
	}
	return data;
}

async function capturePair(params: Record<string, any>): Promise<unknown> {
	const request = {
		projectUuid: requireNonEmptyString(params.projectUuid, 'projectUuid'),
		schematicPageUuid: requireNonEmptyString(params.schematicPageUuid, 'schematicPageUuid'),
		pcbUuid: requireNonEmptyString(params.pcbUuid, 'pcbUuid'),
	};
	const currentUuid = await currentProjectUuid();
	if (currentUuid !== request.projectUuid)
		throw new Error(`capturePair 工程不匹配：请求 ${request.projectUuid}，当前 ${currentUuid}`);
	const data = await callModuleReuse('capturePair', request);
	return validateCapturePairData(data, request);
}

function validateProbeParams(params: Record<string, any>): {
	operationId: string;
	captureId: string;
	targetProjectUuid: string;
	documentType: 'schematic' | 'pcb';
	targetSchematicUuid?: string;
} {
	const operationId = requireNonEmptyString(params.operationId, 'operationId');
	const captureId = requireNonEmptyString(params.captureId, 'captureId');
	const targetProjectUuid = requireNonEmptyString(params.targetProjectUuid, 'targetProjectUuid');
	if (params.documentType !== 'schematic' && params.documentType !== 'pcb')
		throw new Error('documentType 必须是 schematic 或 pcb');
	if (params.documentType === 'schematic') {
		return {
			operationId,
			captureId,
			targetProjectUuid,
			documentType: params.documentType,
			targetSchematicUuid: requireNonEmptyString(params.targetSchematicUuid, 'targetSchematicUuid'),
		};
	}
	if (Object.prototype.hasOwnProperty.call(params, 'targetSchematicUuid'))
		throw new Error('PCB 复制禁止提供 targetSchematicUuid');
	if (Object.prototype.hasOwnProperty.call(params, 'boardName'))
		throw new Error('PCB 原生复制禁止提供 boardName');
	return { operationId, captureId, targetProjectUuid, documentType: 'pcb' };
}

function validateProbeSuccess(data: any, request: ReturnType<typeof validateProbeParams>): string {
	if (!data || typeof data !== 'object' || Array.isArray(data)
		|| data.operationId !== request.operationId
		|| data.captureId !== request.captureId
		|| data.targetProjectUuid !== request.targetProjectUuid
		|| data.documentType !== request.documentType
		|| typeof data.sourceUuid !== 'string' || data.sourceUuid.length === 0
		|| typeof data.createdUuid !== 'string' || data.createdUuid.length === 0
		|| data.state !== 'copyConfirmed' || data.contentMatch !== true
		|| typeof data.sourceObjectCount !== 'number' || typeof data.createdObjectCount !== 'number'
		|| data.dependenciesVerified !== false || data.persisted !== false || data.pairAssociationVerified !== false) {
		throw new Error('module.probeNativeCopy 插件数据错误：成功结果缺少有效的复制身份、内容证据或未验证状态');
	}
	return data.createdUuid;
}

async function probeNativeCopy(params: Record<string, any>): Promise<unknown> {
	const request = validateProbeParams(params);
	const currentBefore = await currentProjectUuid();
	if (currentBefore !== request.targetProjectUuid) {
		throw new Error(`原生复制尚未开始：目标工程不匹配，请求 ${request.targetProjectUuid}，当前 ${currentBefore}`, {
			cause: { partial: false, retryable: false, outcome: 'not_started', operationId: request.operationId, phase: 'precondition_target_project' },
		});
	}

	let rawReply: unknown;
	try {
		rawReply = await eda.sys_MessageBus.rpcCallPublic(MODULE_REUSE_RPC_TOPIC, {
			protocol: 1,
			operation: 'probeNativeCopy',
			params: request,
		});
	}
	catch (error) {
		throw unknownCopyError(error, request.operationId, 'rpc_call');
	}

	let data: any;
	try {
		data = validateReply(rawReply);
	}
	catch (error) {
		const candidateUuid = (rawReply as any)?.data?.createdUuid;
		throw unknownCopyError(error, request.operationId, 'rpc_response', typeof candidateUuid === 'string' && candidateUuid ? candidateUuid : undefined);
	}

	let createdUuid: string | undefined = typeof data?.createdUuid === 'string' && data.createdUuid ? data.createdUuid : undefined;
	try {
		createdUuid = validateProbeSuccess(data, request);
		const currentAfter = await currentProjectUuid();
		if (currentAfter !== request.targetProjectUuid)
			throw new Error(`复制后当前工程不匹配：目标 ${request.targetProjectUuid}，当前 ${currentAfter}`);
		const currentDocument: any = await eda.dmt_SelectControl.getCurrentDocumentInfo();
		const expectedDocumentType = request.documentType === 'schematic' ? 1 : 3;
		if (currentDocument?.uuid !== createdUuid || currentDocument?.documentType !== expectedDocumentType
			|| (currentDocument?.parentProjectUuid && currentDocument.parentProjectUuid !== request.targetProjectUuid)) {
			throw new Error(`复制后文档读回不匹配：期望 ${request.documentType} ${createdUuid} 属于工程 ${request.targetProjectUuid}`);
		}
		return data;
	}
	catch (error) {
		throw unknownCopyError(error, request.operationId, createdUuid ? 'postcondition_verify' : 'validate_success', createdUuid);
	}
}

async function getCopyOperation(params: Record<string, any>): Promise<unknown> {
	const request = { operationId: requireNonEmptyString(params.operationId, 'operationId') };
	const data: any = await callModuleReuse('getCopyOperation', request);
	if (!data || typeof data !== 'object' || Array.isArray(data) || data.operationId !== request.operationId)
		throw new Error('module.getCopyOperation 插件数据错误：持久操作记录缺失或 operationId 不匹配');
	return data;
}

function validateRestoreParams(params: Record<string, any>): { operationId: string; targetProjectUuid: string; fileName: string; base64: string } {
	const expected = ['operationId', 'targetProjectUuid', 'fileName', 'base64'];
	if (!params || typeof params !== 'object' || Array.isArray(params)
		|| Object.keys(params).length !== expected.length || expected.some(key => !Object.prototype.hasOwnProperty.call(params, key))) {
		throw new Error('module.restoreFile 仅接受 operationId、targetProjectUuid、fileName、base64');
	}
	const operationId = requireNonEmptyString(params.operationId, 'operationId');
	const targetProjectUuid = requireNonEmptyString(params.targetProjectUuid, 'targetProjectUuid');
	const fileName = requireNonEmptyString(params.fileName, 'fileName');
	if (/[\\/]/.test(fileName) || !/\.epro2?$/i.test(fileName))
		throw new Error('fileName 必须是 .epro 或 .epro2 原生工程文件名');
	if (typeof params.base64 !== 'string' || !params.base64)
		throw new Error('base64 必须是非空字符串');
	return { operationId, targetProjectUuid, fileName, base64: params.base64 };
}

function unknownRestoreError(error: unknown, operationId: string, phase: string): Error {
	if (error instanceof Error && (error as any)[REMOTE_PLUGIN_FAILURE] === true) {
		if ((error as any).cause?.partial === false || (error as any).cause?.partial === true)
			return error;
	}
	const detail = error instanceof Error ? error.message : String(error);
	return new Error(`工程文件恢复结果未知（operationId=${operationId}）：${detail}`, {
		cause: {
			partial: true,
			retryable: false,
			outcome: 'unknown',
			operationId,
			phase,
			error: detail,
		},
	});
}

function validateRestoreSuccess(data: any, request: ReturnType<typeof validateRestoreParams>): Record<string, unknown> {
	if (!data || typeof data !== 'object' || Array.isArray(data)
		|| data.operationId !== request.operationId
		|| data.targetProjectUuid !== request.targetProjectUuid
		|| data.fileName !== request.fileName
		|| data.fileType !== 'JLCEDA Pro'
		|| data.state !== 'fileImported'
		|| data.phase !== 'metadata_confirmed'
		|| data.importedProjectUuid !== request.targetProjectUuid
		|| data.metadataVerified !== true
		|| data.contentVerified !== false
		|| (data.dependenciesVerified !== undefined && data.dependenciesVerified !== false)
		|| (data.persisted !== undefined && data.persisted !== false)
		|| (data.pairAssociationVerified !== undefined && data.pairAssociationVerified !== false)
		|| data.partial !== false || data.retryable !== false || data.outcome !== 'confirmed') {
		throw new Error('module.restoreFile 插件数据错误：只接受身份匹配且仅确认元数据导入的结果');
	}
	return {
		...data,
		contentVerified: false,
		dependenciesVerified: false,
		persisted: false,
		pairAssociationVerified: false,
	};
}

async function restoreFile(params: Record<string, any>): Promise<Record<string, unknown>> {
	const request = validateRestoreParams(params);
	const currentBefore = await currentProjectUuid();
	if (currentBefore !== request.targetProjectUuid) {
		throw new Error(`文件恢复尚未开始：目标工程不匹配，请求 ${request.targetProjectUuid}，当前 ${currentBefore}`, {
			cause: { partial: false, retryable: false, outcome: 'not_started', operationId: request.operationId, phase: 'precondition_target_project' },
		});
	}

	let data: unknown;
	let rpcError: unknown;
	let rpcFailed = false;
	try {
		data = await callModuleReuse('restoreFile', request);
	}
	catch (error) {
		rpcError = error;
		rpcFailed = true;
	}

	let currentAfter: string | undefined;
	let targetReadError: unknown;
	let targetReadFailed = false;
	try {
		currentAfter = await currentProjectUuid();
	}
	catch (error) {
		targetReadError = error;
		targetReadFailed = true;
	}
	if (rpcFailed)
		throw unknownRestoreError(rpcError, request.operationId, 'rpc_response');
	if (targetReadFailed)
		throw unknownRestoreError(targetReadError, request.operationId, 'postcondition_target_project');
	if (currentAfter !== request.targetProjectUuid)
		throw unknownRestoreError(new Error(`导入后当前工程不匹配：期望 ${request.targetProjectUuid}，当前 ${currentAfter}`), request.operationId, 'postcondition_target_project');
	try {
		return validateRestoreSuccess(data, request);
	}
	catch (error) {
		throw unknownRestoreError(error, request.operationId, 'validate_metadata_result');
	}
}

async function getRestoreOperation(params: Record<string, any>): Promise<unknown> {
	const operationId = requireNonEmptyString(params.operationId, 'operationId');
	if (Object.keys(params).length !== 1)
		throw new Error('module.getRestoreOperation 仅接受 operationId');
	const data: any = await callModuleReuse('getRestoreOperation', { operationId });
	if (!data || typeof data !== 'object' || Array.isArray(data) || data.operationId !== operationId)
		throw new Error('module.getRestoreOperation 插件数据错误：持久操作记录缺失或 operationId 不匹配');
	return data;
}

interface ExportTemplateParams {
	projectUuid: string;
	cbbUuid: string;
	libraryUuid: string;
	templateSchematicUuid: string;
	templatePcbUuid: string;
	fileName: string;
};

function validateExportTemplateParams(params: Record<string, any>): ExportTemplateParams {
	const keys = ['projectUuid', 'cbbUuid', 'libraryUuid', 'templateSchematicUuid', 'templatePcbUuid', 'fileName'];
	if (!params || typeof params !== 'object' || Array.isArray(params)
		|| Object.keys(params).length !== keys.length || keys.some(key => !Object.prototype.hasOwnProperty.call(params, key))) {
		throw new Error('module.exportTemplateFile 仅接受 projectUuid、cbbUuid、libraryUuid、templateSchematicUuid、templatePcbUuid、fileName');
	}
	const request: ExportTemplateParams = {
		projectUuid: requireNonEmptyString(params.projectUuid, 'projectUuid'),
		cbbUuid: requireNonEmptyString(params.cbbUuid, 'cbbUuid'),
		libraryUuid: requireNonEmptyString(params.libraryUuid, 'libraryUuid'),
		templateSchematicUuid: requireNonEmptyString(params.templateSchematicUuid, 'templateSchematicUuid'),
		templatePcbUuid: requireNonEmptyString(params.templatePcbUuid, 'templatePcbUuid'),
		fileName: requireNonEmptyString(params.fileName, 'fileName'),
	};
	if (/[\\/]/.test(request.fileName) || !/\.epro2$/i.test(request.fileName))
		throw new Error('fileName 必须是无路径的 .epro2 文件名');
	return request;
}

function validateExportTemplateData(data: any, request: ExportTemplateParams): Record<string, unknown> {
	const expectedIdentity: Array<keyof ExportTemplateParams> = ['projectUuid', 'cbbUuid', 'libraryUuid', 'templateSchematicUuid', 'templatePcbUuid', 'fileName'];
	if (!data || typeof data !== 'object' || Array.isArray(data)
		|| expectedIdentity.some(key => data[key] !== request[key])
		|| data.exported !== true
		|| typeof data.base64 !== 'string' || data.base64.length === 0
		|| !/^(?:[a-z0-9+/]{4})*(?:[a-z0-9+/]{2}==|[a-z0-9+/]{3}=)?$/i.test(data.base64)
		|| !Number.isSafeInteger(data.size) || data.size <= 0
		|| typeof data.mimeType !== 'string' || data.mimeType.length === 0
		|| data.contentVerified !== false || data.templateBindingVerified !== false) {
		throw new Error('module.exportTemplateFile 插件数据错误：导出身份、文件内容或未验证状态无效');
	}
	const padding = data.base64.endsWith('==') ? 2 : data.base64.endsWith('=') ? 1 : 0;
	const decodedSize = data.base64.length / 4 * 3 - padding;
	if (decodedSize !== data.size)
		throw new Error('module.exportTemplateFile 插件数据错误：size 与 Base64 文件字节数不匹配');
	return data;
}

async function exportTemplateFile(params: Record<string, any>): Promise<Record<string, unknown>> {
	const request = validateExportTemplateParams(params);
	const currentBefore = await currentProjectUuid();
	if (currentBefore !== request.projectUuid)
		throw new Error(`模板导出尚未开始：工程不匹配，请求 ${request.projectUuid}，当前 ${currentBefore}`);
	let data: unknown;
	let rpcError: unknown;
	let rpcFailed = false;
	try {
		data = await callModuleReuse('exportTemplateFile', { ...request });
	}
	catch (error) {
		rpcError = error;
		rpcFailed = true;
	}
	let currentAfter: string;
	try {
		currentAfter = await currentProjectUuid();
	}
	catch (error) {
		if (rpcFailed)
			throw new Error(`模板导出 RPC 失败且无法核对当前工程：${error instanceof Error ? error.message : String(error)}`, { cause: rpcError });
		throw error;
	}
	if (currentAfter !== request.projectUuid)
		throw new Error(`模板导出后当前工程不匹配：期望 ${request.projectUuid}，当前 ${currentAfter}`);
	if (rpcFailed)
		throw rpcError;
	return validateExportTemplateData(data, request);
}

interface PlaceSchematicPageParams {
	operationId: string;
	cbbUuid: string;
	libraryUuid: string;
	sourceSchematicUuid: string;
	sourcePcbUuid: string;
	targetProjectUuid: string;
	targetSchematicUuid: string;
	targetSchematicPageUuid: string;
	targetPcbUuid: string;
	x: number;
	y: number;
	reimportWhenNameRepeated: boolean;
}

interface AlignTemplatePcbParams {
	operationId: string;
	placementOperationId: string;
	targetProjectUuid: string;
	targetSchematicPageUuid: string;
	templateSchematicUuid: string;
	templatePcbUuid: string;
}

interface InstanceNetMapRow {
	sourceNet: string;
	targetNet: string;
	kind: 'internal' | 'interface';
}

interface MapInstanceNetsParams {
	operationId: string;
	placementOperationId: string;
	targetProjectUuid: string;
	targetSchematicPageUuid: string;
	netMap: InstanceNetMapRow[];
}

interface PlacementTarget {
	projectUuid: string;
	documentUuid: string;
	documentType: number;
}

async function readPlacementTarget(): Promise<PlacementTarget> {
	const project: any = await eda.dmt_Project.getCurrentProjectInfo();
	const document: any = await eda.dmt_SelectControl.getCurrentDocumentInfo();
	return {
		projectUuid: requireNonEmptyString(project?.uuid, '当前工程 UUID'),
		documentUuid: requireNonEmptyString(document?.uuid, '当前文档 UUID'),
		documentType: document?.documentType,
	};
}

function validatePlacementTarget(target: PlacementTarget, request: { targetProjectUuid: string; targetSchematicPageUuid: string }, phase: string, operationId: string, beforeWrite: boolean): void {
	if (target.projectUuid === request.targetProjectUuid
		&& target.documentUuid === request.targetSchematicPageUuid
		&& target.documentType === 1) {
		return;
	}
	const cause = {
		partial: !beforeWrite,
		retryable: false,
		outcome: beforeWrite ? 'not_started' : 'unknown',
		operationId,
		phase,
		targetProjectUuid: request.targetProjectUuid,
		currentProjectUuid: target.projectUuid,
		targetSchematicPageUuid: request.targetSchematicPageUuid,
		currentDocumentUuid: target.documentUuid,
	};
	throw new Error(`${beforeWrite ? '放置/对齐尚未开始' : '放置/对齐后目标身份未能确认'}：目标工程与原理图图页身份必须匹配`, { cause });
}

function validateExactParams(params: Record<string, any>, keys: string[], command: string): void {
	if (!params || typeof params !== 'object' || Array.isArray(params)
		|| Object.keys(params).length !== keys.length || keys.some(key => !Object.prototype.hasOwnProperty.call(params, key))) {
		throw new Error(`${command} 仅接受 ${keys.join('、')}`);
	}
}

function validatePlaceSchematicPageParams(params: Record<string, any>): PlaceSchematicPageParams {
	const keys = ['operationId', 'cbbUuid', 'libraryUuid', 'sourceSchematicUuid', 'sourcePcbUuid', 'targetProjectUuid', 'targetSchematicUuid', 'targetSchematicPageUuid', 'targetPcbUuid', 'x', 'y', 'reimportWhenNameRepeated'];
	validateExactParams(params, keys, 'module.placeSchematicPage');
	for (const key of keys.filter(key => key !== 'x' && key !== 'y' && key !== 'reimportWhenNameRepeated'))
		requireNonEmptyString(params[key], key);
	if (typeof params.x !== 'number' || !Number.isFinite(params.x) || typeof params.y !== 'number' || !Number.isFinite(params.y)) {
		throw new TypeError('x 和 y 必须是有限数值');
	}
	if (typeof params.reimportWhenNameRepeated !== 'boolean') {
		throw new TypeError('reimportWhenNameRepeated 必须是布尔值');
	}
	return { ...params } as PlaceSchematicPageParams;
}

function validateAlignTemplatePcbParams(params: Record<string, any>): AlignTemplatePcbParams {
	const keys = ['operationId', 'placementOperationId', 'targetProjectUuid', 'targetSchematicPageUuid', 'templateSchematicUuid', 'templatePcbUuid'];
	validateExactParams(params, keys, 'module.alignTemplatePcb');
	for (const key of keys) {
		requireNonEmptyString(params[key], key);
	}
	return { ...params } as AlignTemplatePcbParams;
}

function validateMapInstanceNetsParams(params: Record<string, any>): MapInstanceNetsParams {
	const keys = ['operationId', 'placementOperationId', 'targetProjectUuid', 'targetSchematicPageUuid', 'netMap'];
	validateExactParams(params, keys, 'module.mapInstanceNets');
	for (const key of keys.slice(0, 4))
		requireNonEmptyString(params[key], key);
	if (!Array.isArray(params.netMap))
		throw new TypeError('netMap 必须是数组');
	const netMap = params.netMap.map((row: any, index: number) => {
		if (!row || typeof row !== 'object' || Array.isArray(row)
			|| Object.keys(row).length !== 3
			|| !Object.prototype.hasOwnProperty.call(row, 'sourceNet')
			|| !Object.prototype.hasOwnProperty.call(row, 'targetNet')
			|| !Object.prototype.hasOwnProperty.call(row, 'kind')) {
			throw new TypeError(`netMap[${index}] 仅接受 sourceNet、targetNet、kind`);
		}
		const sourceNet = requireNonEmptyString(row.sourceNet, `netMap[${index}].sourceNet`);
		const targetNet = requireNonEmptyString(row.targetNet, `netMap[${index}].targetNet`);
		if (row.kind !== 'internal' && row.kind !== 'interface')
			throw new TypeError(`netMap[${index}].kind 必须是 internal 或 interface`);
		return { sourceNet, targetNet, kind: row.kind } as InstanceNetMapRow;
	});
	return { ...params, netMap } as MapInstanceNetsParams;
}

function assertOperationArgs(actual: unknown, expected: Record<string, unknown>, command: string): void {
	if (!actual || typeof actual !== 'object' || Array.isArray(actual)) {
		throw new Error(`${command} 插件数据错误：args 必须是对象`);
	}
	const actualRecord = actual as Record<string, unknown>;
	const expectedKeys = Object.keys(expected);
	if (Object.keys(actualRecord).length !== expectedKeys.length
		|| expectedKeys.some(key => actualRecord[key] !== expected[key])) {
		throw new Error(`${command} 插件数据错误：args 与请求不匹配`);
	}
}

function assertMapInstanceNetsArgs(actual: unknown, expected: MapInstanceNetsParams): void {
	if (!actual || typeof actual !== 'object' || Array.isArray(actual))
		throw new Error('module.mapInstanceNets 插件数据错误：args 必须是对象');
	const actualRecord = actual as Record<string, unknown>;
	const keys = ['operationId', 'placementOperationId', 'targetProjectUuid', 'targetSchematicPageUuid', 'netMap'];
	if (Object.keys(actualRecord).length !== keys.length || keys.some(key => !Object.prototype.hasOwnProperty.call(actualRecord, key)))
		throw new Error('module.mapInstanceNets 插件数据错误：args 与请求不匹配');
	const normalized = validateMapInstanceNetsParams(actualRecord);
	if (normalized.operationId !== expected.operationId
		|| normalized.placementOperationId !== expected.placementOperationId
		|| normalized.targetProjectUuid !== expected.targetProjectUuid
		|| normalized.targetSchematicPageUuid !== expected.targetSchematicPageUuid
		|| JSON.stringify(normalized.netMap) !== JSON.stringify(expected.netMap)) {
		throw new Error('module.mapInstanceNets 插件数据错误：args 与请求不匹配');
	}
}

function validateMapInstanceNetsData(data: any, request: MapInstanceNetsParams): Record<string, unknown> {
	if (!data || typeof data !== 'object' || Array.isArray(data)
		|| data.operationId !== request.operationId || data.targetProjectUuid !== request.targetProjectUuid
		|| data.outcome !== 'mapped'
		|| (data.phase !== 'network-map-readback-confirmed' && data.phase !== 'already-mapped')
		|| data.noOp !== (data.phase === 'already-mapped')
		|| data.contentsVerified !== true || data.geometryUnchanged !== true
		|| data.namedSourcesMapped !== true || data.netlistVerified !== false
		|| !Array.isArray(data.netMap) || !Array.isArray(data.mappedNetworks)
		|| !Array.isArray(data.bindings) || !Array.isArray(data.confirmedIDs)
		|| !Array.isArray(data.pendingIDs) || data.pendingIDs.length !== 0) {
		throw new Error('module.mapInstanceNets 插件数据错误：结果身份、读回状态或验证标志无效');
	}
	assertMapInstanceNetsArgs(data.args, request);
	if (JSON.stringify(data.netMap) !== JSON.stringify(request.netMap)
		|| data.mappedNetworks.length !== request.netMap.length
		|| data.mappedNetworks.some((entry: any, index: number) => {
			const expected = request.netMap[index];
			return !entry || typeof entry !== 'object' || Array.isArray(entry)
				|| entry.sourceNet !== expected.sourceNet || entry.targetNet !== expected.targetNet || entry.kind !== expected.kind
				|| !Array.isArray(entry.wireIds) || entry.wireIds.some((id: unknown) => typeof id !== 'string' || !id)
				|| new Set(entry.wireIds).size !== entry.wireIds.length
				|| !Array.isArray(entry.attributeIds) || entry.attributeIds.some((id: unknown) => typeof id !== 'string' || !id)
				|| new Set(entry.attributeIds).size !== entry.attributeIds.length;
		})) {
		throw new Error('module.mapInstanceNets 插件数据错误：netMap 顺序或映射读回摘要与请求不匹配');
	}
	const bindingsByNetwork = new Map<string, any[]>();
	for (const binding of data.bindings) {
		if (!binding || typeof binding !== 'object' || Array.isArray(binding)
			|| typeof binding.sourceNet !== 'string' || typeof binding.targetNet !== 'string'
			|| (binding.kind !== 'internal' && binding.kind !== 'interface')
			|| typeof binding.wireId !== 'string' || !binding.wireId
			|| typeof binding.attributeId !== 'string' || !binding.attributeId
			|| typeof binding.beforeValue !== 'string' || typeof binding.afterValue !== 'string') {
			throw new Error('module.mapInstanceNets 插件数据错误：binding 读回摘要不完整');
		}
		const networkIndex = data.mappedNetworks.findIndex((entry: any) => entry.sourceNet === binding.sourceNet
			&& entry.targetNet === binding.targetNet && entry.kind === binding.kind);
		if (networkIndex < 0)
			throw new Error('module.mapInstanceNets 插件数据错误：binding 不属于请求中的网络映射');
		const mapped = data.mappedNetworks[networkIndex];
		if (!mapped.wireIds.includes(binding.wireId) || !mapped.attributeIds.includes(binding.attributeId))
			throw new Error('module.mapInstanceNets 插件数据错误：binding ID 与对应 mappedNetworks 不一致');
		const key = JSON.stringify([binding.sourceNet, binding.targetNet, binding.kind]);
		const rows = bindingsByNetwork.get(key) ?? [];
		rows.push(binding);
		bindingsByNetwork.set(key, rows);
	}
	const involvedWireIds = new Set<string>();
	for (const mapped of data.mappedNetworks) {
		const key = JSON.stringify([mapped.sourceNet, mapped.targetNet, mapped.kind]);
		const bindings = bindingsByNetwork.get(key) ?? [];
		const boundWireIds = new Set(bindings.map(binding => binding.wireId));
		const boundAttributeIds = new Set(bindings.map(binding => binding.attributeId));
		if (mapped.wireIds.some((id: string) => !boundWireIds.has(id))
			|| mapped.attributeIds.some((id: string) => !boundAttributeIds.has(id))) {
			throw new Error('module.mapInstanceNets 插件数据错误：bindings 未覆盖 mappedNetworks 声明的 WIRE/ATTR');
		}
		for (const id of mapped.wireIds)
			involvedWireIds.add(id);
	}
	for (const key of ['confirmedIDs'] as const) {
		const ids = data[key];
		if (ids.some((id: unknown) => typeof id !== 'string' || !id) || new Set(ids).size !== ids.length)
			throw new Error('module.mapInstanceNets 插件数据错误：确认的对象 ID 列表无效');
	}
	const confirmedIds = new Set(data.confirmedIDs);
	if ([...involvedWireIds].some(id => !confirmedIds.has(id)))
		throw new Error('module.mapInstanceNets 插件数据错误：confirmedIDs 未覆盖实际涉及的 WIRE');
	if (data.noOp && request.netMap.some(row => row.sourceNet !== row.targetNet))
		throw new Error('module.mapInstanceNets 插件数据错误：含名称变化的映射不能报告 no-op');
	return data;
}

function validatePlaceSchematicPageData(data: any, request: PlaceSchematicPageParams): {
	outcome: 'placed';
	phase: 'placement-readback-confirmed';
	placementVerified: true;
	targetPageReadback: Record<string, unknown>;
	introducedBoards: unknown[];
	pairAssociationVerified: false;
} {
	if (!data || typeof data !== 'object' || Array.isArray(data)
		|| data.operationId !== request.operationId || data.targetProjectUuid !== request.targetProjectUuid
		|| data.outcome !== 'placed' || data.phase !== 'placement-readback-confirmed'
		|| data.sdkResult !== true || data.placementVerified !== true || data.pairAssociationVerified !== false
		|| !data.targetPageReadback || typeof data.targetPageReadback !== 'object' || Array.isArray(data.targetPageReadback)
		|| data.targetPageReadback.uuid !== request.targetSchematicPageUuid
		|| data.targetPageReadback.schematicUuid !== request.targetSchematicUuid
		|| data.targetPageReadback.docType !== 'SCH_PAGE'
		|| !Number.isSafeInteger(data.targetPageReadback.recordCount) || data.targetPageReadback.recordCount <= 0
		|| !Array.isArray(data.targetPageReadback.addedRecordIds) || data.targetPageReadback.addedRecordIds.length === 0
		|| data.targetPageReadback.addedRecordIds.some((id: unknown) => typeof id !== 'string' || id.length === 0)
		|| new Set(data.targetPageReadback.addedRecordIds).size !== data.targetPageReadback.addedRecordIds.length
		|| !Array.isArray(data.targetPageReadback.addedRecords)
		|| data.targetPageReadback.addedRecords.length !== data.targetPageReadback.addedRecordIds.length
		|| data.targetPageReadback.addedRecords.some((record: any) => !record || typeof record.type !== 'string' || !record.type || typeof record.id !== 'string' || !record.id)
		|| new Set(data.targetPageReadback.addedRecords.map((record: any) => record.id)).size !== data.targetPageReadback.addedRecords.length
		|| data.targetPageReadback.addedRecords.some((record: any) => !data.targetPageReadback.addedRecordIds.includes(record.id))
		|| !Array.isArray(data.targetPageReadback.addedComponentIds)
		|| data.targetPageReadback.addedComponentIds.some((id: unknown) => typeof id !== 'string' || id.length === 0)
		|| new Set(data.targetPageReadback.addedComponentIds).size !== data.targetPageReadback.addedComponentIds.length
		|| !Array.isArray(data.targetPageReadback.addedComponents)
		|| data.targetPageReadback.addedComponents.length !== data.targetPageReadback.addedComponentIds.length
		|| data.targetPageReadback.addedComponents.some((component: any) => !component || typeof component.id !== 'string' || !component.id)
		|| new Set(data.targetPageReadback.addedComponents.map((component: any) => component.id)).size !== data.targetPageReadback.addedComponents.length
		|| data.targetPageReadback.addedComponents.some((component: any) => !data.targetPageReadback.addedComponentIds.includes(component.id))
		|| !Array.isArray(data.targetPageReadback.reuseBlocks) || data.targetPageReadback.reuseBlocks.length === 0
		|| !Array.isArray(data.introducedBoards)) {
		throw new Error('module.placeSchematicPage 插件数据错误：目标页读回、新增记录或 introducedBoards 不完整');
	}
	assertOperationArgs(data.args, { ...request }, 'module.placeSchematicPage');
	const newComponentIds = new Set(data.targetPageReadback.addedComponentIds);
	const reuseBlockIds = new Set<string>();
	for (const reuseBlock of data.targetPageReadback.reuseBlocks) {
		if (!reuseBlock || typeof reuseBlock !== 'object' || Array.isArray(reuseBlock)
			|| typeof reuseBlock.componentId !== 'string' || !newComponentIds.has(reuseBlock.componentId)
			|| typeof reuseBlock.value !== 'string' || !reuseBlock.value
			|| (reuseBlock.groupId !== undefined && typeof reuseBlock.groupId !== 'string')
			|| (reuseBlock.channelId !== undefined && typeof reuseBlock.channelId !== 'string')
			|| reuseBlockIds.has(reuseBlock.componentId)) {
			throw new Error('module.placeSchematicPage 插件数据错误：新增组件的 Reuse Block 身份字段缺失或重复');
		}
		reuseBlockIds.add(reuseBlock.componentId);
	}
	const introducedPcbIds = new Set<string>();
	const introducedPageIds = new Set<string>();
	for (const board of data.introducedBoards) {
		if (!board || typeof board !== 'object' || Array.isArray(board)
			|| typeof board.boardName !== 'string' || !board.boardName
			|| typeof board.schematicUuid !== 'string' || !board.schematicUuid
			|| typeof board.schematicName !== 'string' || !board.schematicName
			|| !Array.isArray(board.pageUuids)
			|| board.pageUuids.some((uuid: unknown) => typeof uuid !== 'string' || uuid.length === 0)
			|| typeof board.pcbUuid !== 'string' || !board.pcbUuid
			|| typeof board.pcbName !== 'string' || !board.pcbName
			|| introducedPcbIds.has(board.pcbUuid)) {
			throw new Error('module.placeSchematicPage 插件数据错误：introducedBoards 摘要不完整');
		}
		introducedPcbIds.add(board.pcbUuid);
		for (const pageUuid of board.pageUuids) {
			if (introducedPageIds.has(pageUuid))
				throw new Error('module.placeSchematicPage 插件数据错误：introducedBoards 的图页 UUID 重复');
			introducedPageIds.add(pageUuid);
		}
	}
	return {
		outcome: data.outcome,
		phase: data.phase,
		placementVerified: data.placementVerified,
		targetPageReadback: data.targetPageReadback,
		introducedBoards: data.introducedBoards,
		pairAssociationVerified: data.pairAssociationVerified,
	};
}

function preserveOrMarkPlacementError(error: unknown, operationId: string, phase: string, command: string): Error {
	if (error instanceof Error && (error as any)[REMOTE_PLUGIN_FAILURE] === true) {
		const cause = (error as any).cause;
		if (cause && typeof cause === 'object' && cause.outcome === 'pending-verification') {
			return new Error(`${command} 结果未能确认，不能作为成功继续使用：${error.message}`, {
				cause: { partial: true, retryable: false, outcome: 'unknown', operationId, phase: 'remote_pending_without_verified_success', remoteCause: cause },
			});
		}
		if (cause && typeof cause === 'object'
			&& (cause.partial === false || (cause.partial === true && cause.retryable === false && typeof cause.outcome === 'string'))) {
			return error;
		}
	}
	const detail = error instanceof Error ? error.message : String(error);
	return new Error(`${command} RPC 结果未知（operationId=${operationId}）：${detail}`, {
		cause: { partial: true, retryable: false, outcome: 'unknown', operationId, phase, error: detail },
	});
}

function placementErrorEvidence(value: unknown, seen = new WeakSet<object>()): unknown {
	if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean')
		return value;
	if (typeof value === 'undefined')
		return undefined;
	if (typeof value !== 'object')
		return String(value);
	if (seen.has(value))
		return '[circular]';
	seen.add(value);
	if (value instanceof Error) {
		const evidence: Record<string, unknown> = { name: value.name, message: value.message };
		if (typeof value.stack === 'string')
			evidence.stack = value.stack;
		if (Object.prototype.hasOwnProperty.call(value, 'cause'))
			evidence.cause = placementErrorEvidence((value as Error & { cause?: unknown }).cause, seen);
		return evidence;
	}
	if (Array.isArray(value))
		return value.map(item => placementErrorEvidence(item, seen));
	const evidence: Record<string, unknown> = {};
	for (const [key, item] of Object.entries(value)) {
		if (typeof item !== 'undefined' && typeof item !== 'function' && typeof item !== 'symbol')
			evidence[key] = placementErrorEvidence(item, seen);
	}
	return evidence;
}

function unknownPlacementError(error: unknown, postconditionError: unknown, operationId: string, phase: string, postconditionVerified = false): Error {
	const detail = error instanceof Error ? error.message : String(error);
	const postconditionDetail = postconditionVerified
		? '目标身份后置检查通过'
		: `目标身份后置读回失败：${postconditionError instanceof Error ? postconditionError.message : String(postconditionError)}`;
	return new Error(`原理图页放置结果未知（operationId=${operationId}）：${detail}；${postconditionDetail}`, {
		cause: {
			partial: true,
			retryable: false,
			outcome: 'unknown',
			operationId,
			phase,
			originalError: placementErrorEvidence(error),
			...(postconditionVerified ? { postconditionVerified: true } : { postconditionError: placementErrorEvidence(postconditionError) }),
		},
	});
}

function validateAlignTemplatePcbData(data: any, request: AlignTemplatePcbParams): Record<string, unknown> {
	if (!data || typeof data !== 'object' || Array.isArray(data)
		|| data.operationId !== request.operationId || data.targetProjectUuid !== request.targetProjectUuid
		|| typeof data.phase !== 'string' || data.contentsVerified !== true) {
		throw new Error('module.alignTemplatePcb 插件数据错误：结果身份或读回证据无效');
	}
	assertOperationArgs(data.args, { ...request }, 'module.alignTemplatePcb');
	if (data.outcome === 'reference-aligned'
		&& (data.phase === 'reference-aligned' || data.phase === 'already-aligned')
		&& data.renamed === false
		&& typeof data.noOp === 'boolean'
		&& data.noOp === (data.phase === 'already-aligned')
		&& data.templateContentsUnchanged === true
		&& data.geometryUnchanged === true
		&& Array.isArray(data.affectedIDs)
		&& Array.isArray(data.referenceBeforeAfter)
		&& data.affectedIDs.every((item: any) => item && typeof item === 'object' && !Array.isArray(item)
			&& typeof item.componentId === 'string' && item.componentId.length > 0
			&& typeof item.attributeId === 'string' && item.attributeId.length > 0
			&& typeof item.beforeValue === 'string' && typeof item.afterValue === 'string')
		&& data.referenceBeforeAfter.every((item: any) => item && typeof item === 'object' && !Array.isArray(item)
			&& typeof item.componentId === 'string' && item.componentId.length > 0
			&& typeof item.beforeValue === 'string' && typeof item.afterValue === 'string')
		&& (data.noOp || data.affectedIDs.length > 0)) {
		return data;
	}
	if (data.outcome === 'renamed'
		&& data.phase === 'rename-readback-confirmed' && data.renamed === true && data.noOp === false) {
		return data;
	}
	if (data.outcome === 'no-op'
		&& data.phase === 'already-named' && data.renamed === false && data.noOp === true) {
		return data;
	}
	throw new Error('module.alignTemplatePcb 插件数据错误：只接受有读回证据的引用对齐、legacy renamed 或 no-op 结果');
}

async function placeSchematicPage(params: Record<string, any>): Promise<Record<string, unknown>> {
	const request = validatePlaceSchematicPageParams(params);
	const identity = { targetProjectUuid: request.targetProjectUuid, targetSchematicPageUuid: request.targetSchematicPageUuid };
	const before = await readPlacementTarget();
	validatePlacementTarget(before, identity, 'precondition_target', request.operationId, true);
	let data: unknown;
	let rpcError: unknown;
	try {
		data = await callModuleReuse('placeSchematicPage', { ...request });
	}
	catch (error) {
		rpcError = error;
	}
	let placementEvidence: ReturnType<typeof validatePlaceSchematicPageData> | undefined;
	let validationError: unknown;
	try {
		if (!rpcError)
			placementEvidence = validatePlaceSchematicPageData(data, request);
	}
	catch (error) {
		validationError = error;
	}
	if (placementEvidence)
		return { operationId: request.operationId, targetProjectUuid: request.targetProjectUuid, sdkResult: true, ...placementEvidence };

	const originalError = rpcError ?? validationError;
	let postconditionError: unknown;
	try {
		const after = await readPlacementTarget();
		validatePlacementTarget(after, identity, 'postcondition_target', request.operationId, false);
	}
	catch (error) {
		postconditionError = error;
	}
	if (postconditionError)
		throw unknownPlacementError(originalError, postconditionError, request.operationId, rpcError ? 'postcondition_after_rpc_error' : 'postcondition_after_invalid_response');
	if (rpcError)
		throw preserveOrMarkPlacementError(rpcError, request.operationId, 'rpc_call', '原理图页放置');
	throw unknownPlacementError(originalError, undefined, request.operationId, 'validate_response', true);
}

async function alignTemplatePcb(params: Record<string, any>): Promise<Record<string, unknown>> {
	const request = validateAlignTemplatePcbParams(params);
	const identity = { targetProjectUuid: request.targetProjectUuid, targetSchematicPageUuid: request.targetSchematicPageUuid };
	const before = await readPlacementTarget();
	validatePlacementTarget(before, identity, 'precondition_target', request.operationId, true);
	let data: unknown;
	let rpcError: unknown;
	try {
		data = await callModuleReuse('alignTemplatePcb', { ...request });
	}
	catch (error) {
		rpcError = error;
	}
	let after: PlacementTarget | undefined;
	let postconditionError: unknown;
	try {
		after = await readPlacementTarget();
		validatePlacementTarget(after, identity, 'postcondition_target', request.operationId, false);
	}
	catch (error) {
		postconditionError = error;
	}
	if (rpcError) {
		if (postconditionError && rpcError instanceof Error && (rpcError as any)[REMOTE_PLUGIN_FAILURE] === true) {
			const remoteCause = (rpcError as any).cause;
			throw new Error(`PCB 模板对齐 RPC 返回错误且目标身份读回异常：${String((postconditionError as Error).message ?? postconditionError)}`, {
				cause: { ...(remoteCause && typeof remoteCause === 'object' ? remoteCause : {}), partial: true, retryable: false, outcome: 'unknown', operationId: request.operationId, phase: 'postcondition_target', remoteCause },
			});
		}
		if (postconditionError)
			throw postconditionError;
		throw preserveOrMarkPlacementError(rpcError, request.operationId, 'rpc_call', 'PCB 模板对齐');
	}
	if (postconditionError)
		throw postconditionError;
	try {
		return validateAlignTemplatePcbData(data, request);
	}
	catch (error) {
		const detail = error instanceof Error ? error.message : String(error);
		throw new Error(`PCB 模板对齐结果未能验证（operationId=${request.operationId}）：${detail}`, {
			cause: { partial: true, retryable: false, outcome: 'unknown', operationId: request.operationId, phase: 'validate_response', error: detail },
		});
	}
}

async function mapInstanceNets(params: Record<string, any>): Promise<Record<string, unknown>> {
	const request = validateMapInstanceNetsParams(params);
	const identity = { targetProjectUuid: request.targetProjectUuid, targetSchematicPageUuid: request.targetSchematicPageUuid };
	const before = await readPlacementTarget();
	validatePlacementTarget(before, identity, 'precondition_target', request.operationId, true);
	let data: unknown;
	let rpcError: unknown;
	try {
		data = await callModuleReuse('mapInstanceNets', { ...request });
	}
	catch (error) {
		rpcError = error;
	}
	let postconditionError: unknown;
	try {
		const after = await readPlacementTarget();
		validatePlacementTarget(after, identity, 'postcondition_target', request.operationId, false);
	}
	catch (error) {
		postconditionError = error;
	}
	if (rpcError) {
		if (postconditionError && rpcError instanceof Error && (rpcError as any)[REMOTE_PLUGIN_FAILURE] === true) {
			const remoteCause = (rpcError as any).cause;
			if (remoteCause && typeof remoteCause === 'object'
				&& ((remoteCause.outcome === 'not_started' && remoteCause.partial === false)
					|| (remoteCause.outcome === 'unknown' && remoteCause.partial === true && remoteCause.retryable === false))) {
				throw rpcError;
			}
			throw new Error(`网络映射 RPC 返回错误且目标身份读回异常：${String((postconditionError as Error).message ?? postconditionError)}`, {
				cause: { ...(remoteCause && typeof remoteCause === 'object' ? remoteCause : {}), partial: true, retryable: false, outcome: 'unknown', operationId: request.operationId, phase: 'postcondition_target', remoteCause },
			});
		}
		if (postconditionError)
			throw postconditionError;
		throw preserveOrMarkPlacementError(rpcError, request.operationId, 'rpc_call', '实例网络映射');
	}
	if (postconditionError)
		throw postconditionError;
	try {
		return validateMapInstanceNetsData(data, request);
	}
	catch (error) {
		const detail = error instanceof Error ? error.message : String(error);
		throw new Error(`实例网络映射结果未知（operationId=${request.operationId}）：${detail}`, {
			cause: { partial: true, retryable: false, outcome: 'unknown', operationId: request.operationId, phase: 'validate_response', error: detail },
		});
	}
}

async function getPlacementOperation(params: Record<string, any>): Promise<unknown> {
	const keys = ['operationId', 'targetProjectUuid'];
	validateExactParams(params, keys, 'module.getPlacementOperation');
	const operationId = requireNonEmptyString(params.operationId, 'operationId');
	const targetProjectUuid = requireNonEmptyString(params.targetProjectUuid, 'targetProjectUuid');
	const data: any = await callModuleReuse('getPlacementOperation', { operationId, targetProjectUuid });
	if (!data || typeof data !== 'object' || Array.isArray(data)
		|| data.operationId !== operationId || data.targetProjectUuid !== targetProjectUuid
		|| typeof data.outcome !== 'string' || data.outcome.length === 0
		|| typeof data.phase !== 'string' || data.phase.length === 0) {
		throw new Error('module.getPlacementOperation 插件数据错误：操作身份、outcome 或 phase 缺失/不匹配');
	}
	if (!data.args || typeof data.args !== 'object' || Array.isArray(data.args)) {
		throw new Error('module.getPlacementOperation 插件数据错误：持久 args 必须包含请求身份');
	}
	let args: PlaceSchematicPageParams | AlignTemplatePcbParams | MapInstanceNetsParams;
	if (Object.prototype.hasOwnProperty.call(data.args, 'cbbUuid'))
		args = validatePlaceSchematicPageParams(data.args);
	else if (Object.prototype.hasOwnProperty.call(data.args, 'netMap'))
		args = validateMapInstanceNetsParams(data.args);
	else
		args = validateAlignTemplatePcbParams(data.args);
	if (args.operationId !== operationId || args.targetProjectUuid !== targetProjectUuid)
		throw new Error('module.getPlacementOperation 插件数据错误：持久 args 与请求身份不匹配');
	return data;
}

function validateStatus(data: unknown): Record<string, unknown> {
	if (!data || typeof data !== 'object' || Array.isArray(data))
		throw new Error('module.getStatus 插件数据错误：状态必须是对象');
	const capabilities = (data as Record<string, unknown>).capabilities;
	if (!Array.isArray(capabilities)
		|| capabilities.some(value => typeof value !== 'string' || value.length === 0)) {
		throw new Error('module.getStatus 插件数据错误：capabilities 必须是只包含非空字符串的数组');
	}
	const nativeCapabilities = (data as Record<string, any>).nativeCapabilities;
	if (nativeCapabilities !== undefined
		&& (!nativeCapabilities || typeof nativeCapabilities !== 'object' || Array.isArray(nativeCapabilities)
			|| Object.values(nativeCapabilities).some(value => typeof value !== 'boolean'))) {
		throw new Error('module.getStatus 插件数据错误：提供 nativeCapabilities 时必须是仅含布尔值的对象');
	}
	return data as Record<string, unknown>;
}

async function getContext(params: Record<string, any>): Promise<unknown> {
	const expected = {
		projectUuid: requireNonEmptyString(params.projectUuid, 'projectUuid'),
		documentUuid: requireNonEmptyString(params.documentUuid, 'documentUuid'),
	};
	const before = await readTargetIds();
	assertRequestedTarget(before, expected, 'RPC 前');

	const data: any = await callModuleReuse('getContext', expected);

	const after = await readTargetIds();
	assertRequestedTarget(after, expected, 'RPC 后');
	if (!data || typeof data !== 'object' || Array.isArray(data))
		throw new Error('module-reuse RPC 数据错误：getContext data 必须是对象');
	if (!data.project || typeof data.project !== 'object' || Array.isArray(data.project))
		throw new Error('module-reuse RPC 数据错误：getContext project 必须是对象');
	if (!data.document || typeof data.document !== 'object' || Array.isArray(data.document))
		throw new Error('module-reuse RPC 数据错误：getContext document 必须是对象');
	if (data.project?.uuid !== expected.projectUuid)
		throw new Error(`module-reuse RPC 返回的工程身份不匹配：期望 ${expected.projectUuid}`);
	if (data.document?.uuid !== expected.documentUuid)
		throw new Error(`module-reuse RPC 返回的文档身份不匹配：期望 ${expected.documentUuid}`);
	return data;
}

function validatePcbImportArgs(params: Record<string, any>): Record<string, unknown> {
	const keys = ['operationId', 'targetProjectUuid', 'targetSchematicUuid', 'targetSchematicPageUuid', 'targetPcbUuid', 'placementOperationIds'];
	validateExactParams(params, keys, 'module.importPcbInstances');
	const args: Record<string, unknown> = {};
	for (const key of keys.filter(key => key !== 'placementOperationIds')) args[key] = requireNonEmptyString(params[key], key);
	if (!Array.isArray(params.placementOperationIds) || !params.placementOperationIds.length)
		throw new Error('placementOperationIds 必须包含放置操作 ID');
	const ids = params.placementOperationIds.map((id: unknown) => requireNonEmptyString(id, 'placementOperationIds'));
	if (new Set(ids).size !== ids.length)
		throw new Error('placementOperationIds 不可重复');
	args.placementOperationIds = ids;
	return args;
}

function validatePcbImportRecord(data: any, operationId: string, projectUuid: string): any {
	if (!data || typeof data !== 'object' || Array.isArray(data) || data.operation !== 'importPcbInstances'
		|| data.operationId !== operationId || data.targetProjectUuid !== projectUuid
		|| !['confirmed', 'not_started', 'unknown'].includes(data.outcome) || typeof data.phase !== 'string' || !data.phase
		|| data.stage !== 'pcb_component_import_and_footprint_reference' || typeof data.writeAttempted !== 'boolean'
		|| (data.outcome === 'confirmed' && data.writeAttempted !== true)) {
		throw new Error('module PCB 导入记录身份或阶段数据不完整');
	}
	validateExactParams(data.args, ['targetProjectUuid', 'targetSchematicUuid', 'targetSchematicPageUuid', 'targetPcbUuid', 'placementOperationIds'], 'module PCB 导入记录 args');
	const args = validatePcbImportArgs({ operationId: data.operationId, ...data.args });
	if (args.operationId !== operationId || args.targetProjectUuid !== projectUuid)
		throw new Error('module PCB 导入记录参数身份不符');
	return data;
}

async function importPcbInstances(params: Record<string, any>): Promise<unknown> {
	const args = validatePcbImportArgs(params);
	const operationId = args.operationId as string;
	const projectUuid = args.targetProjectUuid as string;
	const project: any = await eda.dmt_Project.getCurrentProjectInfo();
	if (project?.uuid !== projectUuid)
		throw new Error('PCB 实例导入目标工程与当前工程不一致');
	try {
		const data = validatePcbImportRecord(await callModuleReuse('importPcbInstances', args), operationId, projectUuid);
		const normalized = validatePcbImportArgs({ operationId: data.operationId, ...data.args });
		if (Object.keys(args).some(key => JSON.stringify(normalized[key]) !== JSON.stringify(args[key])))
			throw new Error('PCB 导入返回参数与请求不一致');
		if (data.outcome !== 'confirmed')
			throw new Error(data.error || 'PCB 导入尚未确认', { cause: { partial: data.writeAttempted || data.outcome === 'unknown', retryable: false, outcome: data.outcome, operationId, phase: data.phase } });
		return data;
	}
	catch (error) {
		if (error instanceof Error && typeof (error as any).cause?.partial === 'boolean')
			throw error;
		throw new Error(`PCB 实例导入结果未知：${error instanceof Error ? error.message : String(error)}`, { cause: { partial: true, retryable: false, outcome: 'unknown', operationId, phase: 'rpc_pcb_import' } });
	}
}

async function getPcbImportOperation(params: Record<string, any>): Promise<unknown> {
	validateExactParams(params, ['operationId', 'targetProjectUuid'], 'module.getPcbImportOperation');
	const operationId = requireNonEmptyString(params.operationId, 'operationId');
	const targetProjectUuid = requireNonEmptyString(params.targetProjectUuid, 'targetProjectUuid');
	return validatePcbImportRecord(await callModuleReuse('getPcbImportOperation', { operationId, targetProjectUuid }), operationId, targetProjectUuid);
}

export const moduleReuseCommands: Array<ICommandDef> = [
	{
		name: 'module.getStatus',
		summary: '读取独立 module-reuse 插件状态与原生方法存在标志（标志不代表实测成功）',
		params: [],
		returns: '独立插件返回的状态信息',
		example: { cmd: 'module.getStatus' },
		handler: async () => validateStatus(await callModuleReuse('getStatus')),
	},
	{
		name: 'module.getContext',
		summary: '读取独立插件中指定工程和文档的上下文',
		params: [
			{ name: 'projectUuid', type: 'string', required: true, description: '目标工程 UUID' },
			{ name: 'documentUuid', type: 'string', required: true, description: '目标文档 UUID' },
		],
		returns: '{ project, document }（已核对 RPC 前后当前目标身份）',
		example: { cmd: 'module.getContext', params: { projectUuid: 'project-uuid', documentUuid: 'document-uuid' } },
		handler: async params => await getContext(params),
	},
	{
		name: 'module.capturePair',
		summary: '在当前工程捕获指定原理图页与 PCB 的复用来源摘要',
		params: [
			{ name: 'projectUuid', type: 'string', required: true, description: '当前工程 UUID' },
			{ name: 'schematicPageUuid', type: 'string', required: true, description: '来源原理图图页 UUID' },
			{ name: 'pcbUuid', type: 'string', required: true, description: '来源 PCB UUID' },
		],
		returns: '{ captureId, source, documents }（原始源码保存在独立插件）',
		example: { cmd: 'module.capturePair', params: { projectUuid: 'project-uuid', schematicPageUuid: 'page-uuid', pcbUuid: 'pcb-uuid' } },
		handler: async params => await capturePair(params),
	},
	{
		name: 'module.probeNativeCopy',
		summary: '对已捕获的复用来源执行一次原生跨工程复制探测；不验证依赖、持久化或配对关联',
		params: [
			{ name: 'operationId', type: 'string', required: true, description: '持久操作 ID' },
			{ name: 'captureId', type: 'string', required: true, description: 'module.capturePair 返回的 captureId' },
			{ name: 'targetProjectUuid', type: 'string', required: true, description: '目标当前工程 UUID' },
			{ name: 'documentType', type: 'string', required: true, description: 'schematic 或 pcb' },
			{ name: 'targetSchematicUuid', type: 'string', description: 'documentType=schematic 时必填；PCB 禁止传入' },
		],
		returns: '{ operationId, createdUuid, contentMatch, sourceObjectCount, createdObjectCount, dependenciesVerified:false, persisted:false, pairAssociationVerified:false }',
		example: { cmd: 'module.probeNativeCopy', params: { operationId: 'operation-id', captureId: 'capture-id', targetProjectUuid: 'target-project-uuid', documentType: 'pcb' } },
		handler: async params => await probeNativeCopy(params),
	},
	{
		name: 'module.getCopyOperation',
		summary: '只读查询 module.probeNativeCopy 的持久操作记录（可在写保护期间调用）',
		params: [
			{ name: 'operationId', type: 'string', required: true, description: '持久操作 ID' },
		],
		returns: '持久操作记录（含当前 state、phase 与可用的复制结果证据）',
		example: { cmd: 'module.getCopyOperation', params: { operationId: 'operation-id' } },
		handler: async params => await getCopyOperation(params),
	},
	{
		name: 'module.restoreFile',
		summary: '将本地模块原生工程文件单次导入指定现有工程；当前仅确认元数据导入',
		params: [
			{ name: 'operationId', type: 'string', required: true, description: '持久操作 ID；同 ID、同文件重复调用由独立插件查回记录，不重发导入' },
			{ name: 'targetProjectUuid', type: 'string', required: true, description: '当前目标工程 UUID' },
			{ name: 'fileName', type: 'string', required: true, description: '原生 .epro 或 .epro2 工程文件名，不含路径' },
			{ name: 'base64', type: 'string', required: true, description: '原生工程文件的标准 Base64 内容' },
		],
		returns: '{ operationId, importedProjectUuid, metadataVerified:true, contentVerified:false, dependenciesVerified:false, persisted:false, pairAssociationVerified:false }',
		example: { cmd: 'module.restoreFile', params: { operationId: 'operation-id', targetProjectUuid: 'target-project-uuid', fileName: 'module.epro2', base64: '...' } },
		handler: async params => await restoreFile(params),
	},
	{
		name: 'module.getRestoreOperation',
		summary: '只读查询 module.restoreFile 的持久操作记录（写入期间可调用）',
		params: [
			{ name: 'operationId', type: 'string', required: true, description: '持久操作 ID' },
		],
		returns: '文件恢复操作记录（含当前 state、phase 与可用的元数据证据）',
		example: { cmd: 'module.getRestoreOperation', params: { operationId: 'operation-id' } },
		handler: async params => await getRestoreOperation(params),
	},
	{
		name: 'module.exportTemplateFile',
		summary: '从指定工程的模板树导出原生 .epro2 文件；不验证导出内容与模板绑定',
		params: [
			{ name: 'projectUuid', type: 'string', required: true, description: '模板所在工程 UUID' },
			{ name: 'cbbUuid', type: 'string', required: true, description: 'CBB UUID' },
			{ name: 'libraryUuid', type: 'string', required: true, description: '模板库 UUID' },
			{ name: 'templateSchematicUuid', type: 'string', required: true, description: '模板原理图 UUID' },
			{ name: 'templatePcbUuid', type: 'string', required: true, description: '模板 PCB UUID' },
			{ name: 'fileName', type: 'string', required: true, description: '无路径的 .epro2 文件名' },
		],
		returns: '{ exported:true, size, mimeType, base64, contentVerified:false, templateBindingVerified:false }（仅导出文件，不表示模板已登记）',
		example: { cmd: 'module.exportTemplateFile', params: { projectUuid: 'project-uuid', cbbUuid: 'cbb-uuid', libraryUuid: 'library-uuid', templateSchematicUuid: 'schematic-uuid', templatePcbUuid: 'pcb-uuid', fileName: 'template.epro2' } },
		handler: async params => await exportTemplateFile(params),
	},
	{
		name: 'module.placeSchematicPage',
		summary: '向指定目标原理图页执行原生 CBB 图页放置，并读回确认新增组件与 Reuse Block；PCB 配对状态单独保留为未验证',
		params: [
			{ name: 'operationId', type: 'string', required: true, description: '持久放置操作 ID' },
			{ name: 'cbbUuid', type: 'string', required: true, description: '源 CBB UUID' },
			{ name: 'libraryUuid', type: 'string', required: true, description: '源 CBB 库 UUID' },
			{ name: 'sourceSchematicUuid', type: 'string', required: true, description: 'CBB 原理图模板 UUID' },
			{ name: 'sourcePcbUuid', type: 'string', required: true, description: '同一 CBB 的 PCB 模板 UUID' },
			{ name: 'targetProjectUuid', type: 'string', required: true, description: '目标工程 UUID' },
			{ name: 'targetSchematicUuid', type: 'string', required: true, description: '目标原理图 UUID' },
			{ name: 'targetSchematicPageUuid', type: 'string', required: true, description: '当前目标原理图页 UUID' },
			{ name: 'targetPcbUuid', type: 'string', required: true, description: '成套目标 PCB UUID' },
			{ name: 'x', type: 'number', required: true, description: '放置坐标 X，单位为 SCH 10 mil，必须为有限值' },
			{ name: 'y', type: 'number', required: true, description: '放置坐标 Y，单位为 SCH 10 mil，必须为有限值' },
			{ name: 'reimportWhenNameRepeated', type: 'boolean', required: true, description: '重名时是否重新引入' },
		],
		returns: '{ operationId, targetPageReadback, introducedBoards, placementVerified:true, pairAssociationVerified:false }；仅确认当前图页放置结果，PCB 配对仍需独立对齐操作验证',
		example: { cmd: 'module.placeSchematicPage', params: { operationId: 'operation-id', cbbUuid: 'cbb-uuid', libraryUuid: 'library-uuid', sourceSchematicUuid: 'source-sch-template-uuid', sourcePcbUuid: 'source-pcb-template-uuid', targetProjectUuid: 'target-project-uuid', targetSchematicUuid: 'target-schematic-uuid', targetSchematicPageUuid: 'target-page-uuid', targetPcbUuid: 'target-pcb-uuid', x: 1200, y: 900, reimportWhenNameRepeated: true } },
		handler: async params => await placeSchematicPage(params),
	},
	{
		name: 'module.alignTemplatePcb',
		summary: '按已绑定模板更新目标原理图页组件的 ATTR value 引用并读回核对；不导入 PCB 内容，模板内容与几何保持不变',
		params: [
			{ name: 'operationId', type: 'string', required: true, description: '持久对齐操作 ID' },
			{ name: 'placementOperationId', type: 'string', required: true, description: '已读回的 module.placeSchematicPage 操作 ID' },
			{ name: 'targetProjectUuid', type: 'string', required: true, description: '目标工程 UUID' },
			{ name: 'targetSchematicPageUuid', type: 'string', required: true, description: '当前目标原理图页 UUID' },
			{ name: 'templateSchematicUuid', type: 'string', required: true, description: '模板原理图 UUID' },
			{ name: 'templatePcbUuid', type: 'string', required: true, description: '模板 PCB UUID' },
		],
		returns: '{ outcome:reference-aligned, phase, affectedIDs, referenceBeforeAfter, contentsVerified:true, templateContentsUnchanged:true, geometryUnchanged:true }；仅对齐组件引用，不代表 PCB 内容已导入',
		example: { cmd: 'module.alignTemplatePcb', params: { operationId: 'operation-id', placementOperationId: 'placement-operation-id', targetProjectUuid: 'target-project-uuid', targetSchematicPageUuid: 'target-page-uuid', templateSchematicUuid: 'template-sch-uuid', templatePcbUuid: 'template-pcb-uuid' } },
		handler: async params => await alignTemplatePcb(params),
	},
	{
		name: 'module.mapInstanceNets',
		summary: '按来源网络映射表更新已放置实例的网络引用并读回核对；不导入 PCB 内容，网表仍未验证',
		params: [
			{ name: 'operationId', type: 'string', required: true, description: '持久映射操作 ID' },
			{ name: 'placementOperationId', type: 'string', required: true, description: '已确认的 module.placeSchematicPage 操作 ID' },
			{ name: 'targetProjectUuid', type: 'string', required: true, description: '目标工程 UUID' },
			{ name: 'targetSchematicPageUuid', type: 'string', required: true, description: '当前目标原理图页 UUID' },
			{ name: 'netMap', type: 'object[]', required: true, description: '按顺序提供 { sourceNet, targetNet, kind: internal|interface } 映射行' },
		],
		returns: '{ outcome:mapped, mappedNetworks, bindings, confirmedIDs, pendingIDs:[], contentsVerified:true, geometryUnchanged:true, namedSourcesMapped:true, netlistVerified:false }',
		example: { cmd: 'module.mapInstanceNets', params: { operationId: 'operation-id', placementOperationId: 'placement-operation-id', targetProjectUuid: 'target-project-uuid', targetSchematicPageUuid: 'target-page-uuid', netMap: [{ sourceNet: 'GND', targetNet: 'GND', kind: 'interface' }, { sourceNet: 'VCC', targetNet: 'VDD', kind: 'internal' }] } },
		handler: async params => await mapInstanceNets(params),
	},
	{
		name: 'module.getPlacementOperation',
		summary: '只读查询图页放置、PCB 对齐或实例网络映射的持久操作记录；查询不会重放写入',
		params: [
			{ name: 'operationId', type: 'string', required: true, description: '持久操作 ID' },
			{ name: 'targetProjectUuid', type: 'string', required: true, description: '目标工程 UUID' },
		],
		returns: '匹配请求身份的持久操作记录；原理图放置含 placementVerified 与 pairAssociationVerified',
		example: { cmd: 'module.getPlacementOperation', params: { operationId: 'operation-id', targetProjectUuid: 'target-project-uuid' } },
		handler: async params => await getPlacementOperation(params),
	},
	{ name: 'module.importPcbInstances', summary: '在独立插件内确认网表身份、导入PCB器件并恢复模板完整封装引用；布局布线及保存重开分开报告', params: [
		{ name: 'operationId', type: 'string', required: true, description: '持久操作 ID' },
		{ name: 'targetProjectUuid', type: 'string', required: true, description: '目标工程 UUID' },
		{ name: 'targetSchematicUuid', type: 'string', required: true, description: '目标父原理图 UUID' },
		{ name: 'targetSchematicPageUuid', type: 'string', required: true, description: '目标主图页 UUID' },
		{ name: 'targetPcbUuid', type: 'string', required: true, description: '同板目标 PCB UUID' },
		{ name: 'placementOperationIds', type: 'string[]', required: true, description: '要处理的已放置实例操作 ID 列表' },
	], returns: '持久的 PCB 导入阶段结果；不代表完整布局布线与保存重开', example: { cmd: 'module.importPcbInstances', params: { operationId: 'pcb-import', targetProjectUuid: 'project', targetSchematicUuid: 'sch', targetSchematicPageUuid: 'page', targetPcbUuid: 'pcb', placementOperationIds: ['placement'] } }, handler: async params => await importPcbInstances(params) },
	{ name: 'module.getPcbImportOperation', summary: '只读查询PCB实例导入持久记录，不重发写入', params: [{ name: 'operationId', type: 'string', required: true, description: '操作 ID' }, { name: 'targetProjectUuid', type: 'string', required: true, description: '目标工程 UUID' }], returns: '匹配请求身份的持久 PCB 导入结果', example: { cmd: 'module.getPcbImportOperation', params: { operationId: 'pcb-import', targetProjectUuid: 'project' } }, handler: async params => await getPcbImportOperation(params) },
];
