/**
 * Content that goes inside a tagged block of a prompt (a transcript, a memory file, the
 * host's words): angle brackets are bent so a spoken "</transcript>" can never close the
 * block early, nor open a new one.
 */
export const bendAngles = (text: string) => text.replace(/</g, "‹").replace(/>/g, "›");
