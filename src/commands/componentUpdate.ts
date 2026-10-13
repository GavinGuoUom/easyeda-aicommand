import type { ICommandDef } from '../engine/types';
import { getComponentUpdatePlan, updateComponents } from '../engine/componentUpdate';

export const componentUpdateCommands: Array<ICommandDef> = [
	{
		name: 'schematic.getComponentUpdatePlan',
		summary: '读取原理图器件并生成原位换封装/批量属性更新计划，不写工程或库',
		params: [{ name: 'items', type: 'array', required: true, description: '器件列表：{primitiveId, footprint?:{uuid,libraryUuid}, properties?:{manufacturer,manufacturerId,supplier,supplierId,name,designator,addIntoBom,addIntoPcb,otherProperty}}；properties 只传要改字段' }],
		returns: '计划对象：含文档身份、源码指纹、每项变化、原器件/属性基线指纹与目标封装焊盘号；仅供 schematic.updateComponents 执行',
		example: { cmd: 'schematic.getComponentUpdatePlan', params: { items: [{ primitiveId: 'component-uuid', footprint: { uuid: 'footprint-uuid', libraryUuid: 'library-uuid' }, properties: { manufacturerId: 'ABC-123' } }] } },
		handler: async params => getComponentUpdatePlan(eda as any, params.items),
	},
	{
		name: 'schematic.updateComponents',
		summary: '执行并逐项读回原位换封装与批量属性更新计划；PCB 仍需通过现有导入变更指令同步',
		params: [{ name: 'plan', type: 'object', required: true, description: 'schematic.getComponentUpdatePlan 返回的完整计划对象' }],
		returns: '{ updated, verified, copiedResources, verificationScope, electricalMappingVerified:false, pcbSynchronized:false, persistenceVerified:false }；verified核对原理图更新，不代表任意封装电气映射；部分写入错误在 error.cause 中提供 copiedResources/updated/verified/notAttempted',
		example: { cmd: 'schematic.updateComponents', params: { plan: '$plan' } },
		handler: async params => updateComponents(eda as any, params.plan),
	},
];
