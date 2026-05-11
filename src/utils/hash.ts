export function hashString(value: string): string {
	let hash = 0x811c9dc5;

	for (let index = 0; index < value.length; index++) {
		hash ^= value.charCodeAt(index);
		hash = Math.imul(hash, 0x01000193);
	}

	return `${value.length.toString(36)}-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}
