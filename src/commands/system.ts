/** 长任务状态查询（0.10.42） */
import type { ICommandDef } from '../engine/types'
import { getTask, listTasks } from '../engine/tasks'

export const systemCommands: Array<ICommandDef> = [
	{
		name: 'task.get',
		summary: '查询长任务状态与结果（0.10.42，GPT KIMI-EDA-20261002-03）：批量删除等长指令客户端超时后，扩展侧任务仍在跑——用本指令查实时进度（state/progress），完成后补取最终结果（result），不要盲重发。相同参数的任务在跑时重发原指令会直接返回 running 进度而不会重复执行。结果保留 15 分钟',
		params: [
			{ name: 'taskId', type: 'string', required: true, description: '任务 ID（长指令返回里的 taskId 字段）' },
		],
		returns: '{ id, cmd, state: running|done|error, startedAt, updatedAt, progress, result?, error? }',
		example: { cmd: 'task.get', params: { taskId: 'task-xxx-1' } },
		handler: async (params) => {
			if (!params.taskId)
				throw new Error('缺少参数 taskId')
			const t = getTask(String(params.taskId))
			if (!t)
				throw new Error(`任务不存在或结果已过期（结果只保留 15 分钟）：${params.taskId}。用 task.list 看当前在册任务`)
			return t
		},
	},
	{
		name: 'task.list',
		summary: '列出在册长任务（不含结果正文，看详情用 task.get）',
		params: [],
		returns: '{ tasks: [{ id, cmd, state, startedAt, updatedAt, error? }], count }——0.10.44 起包一层对象：空注册表是 count:0/tasks:[]，不是 null；null 不可作为「后台已无任务」的证据',
		example: { cmd: 'task.list' },
		handler: async () => {
			const tasks = listTasks()
			return { tasks, count: tasks.length }
		},
	},
]
