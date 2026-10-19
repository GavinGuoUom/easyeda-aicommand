/** Guard APIs introduced in EDA 4.2 before invoking them on older hosts. */
export function requireEda42(command: string): void {
	const environment = eda.sys_Environment
	const version = environment.getEditorCurrentVersion()
	if (typeof version !== 'string' || !/^\d+\.\d+(?:\.\d+)?/.test(version))
		throw new Error(`${command} 无法确认 EDA 宿主版本；该接口需要 EDA 4.2 或更高版本，已停止调用`)
	// SDK wording compares the supplied version against the current editor,
	// so LessThanOrEqual('4.2.0') means current editor >= 4.2.0.
	if (!environment.isEditorCurrentVersionLessThanOrEqual('4.2.0'))
		throw new Error(`${command} 不支持当前 EDA ${version}；该接口需要 EDA 4.2 或更高版本`)
}

export function isEda42OrNewer(): boolean {
	const environment = eda.sys_Environment
	const version = environment.getEditorCurrentVersion()
	if (typeof version !== 'string' || !/^\d+\.\d+(?:\.\d+)?/.test(version))
		throw new Error('无法确认 EDA 宿主版本；已停止调用 4.2 专用接口')
	return environment.isEditorCurrentVersionLessThanOrEqual('4.2.0')
}
