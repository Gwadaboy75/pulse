// Shared by the coach's server tools and the chat UI: the medical write tools, each of which waits for the user's tap.
export const MEDICAL_WRITE_TOOLS = ["log_medication_taken", "add_medication"] as const
export type MedicalWriteToolName = (typeof MEDICAL_WRITE_TOOLS)[number]
export const isMedicalWriteTool = (name: string): name is MedicalWriteToolName => (MEDICAL_WRITE_TOOLS as readonly string[]).includes(name)
