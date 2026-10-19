/** File extensions we can hand to mpv. Playback still depends on the file's actual codecs. */
export const VIDEO_FILE_RE =
  /\.(?:mkv|mp4|m4v|mov|avi|wmv|webm|ts|m2ts|mts|m2t|mpg|mpeg|mpe|m1v|m2v|m2p|flv|f4v|ogv|ogm|3gp|3g2|vob|evo|vro|iso|divx|asf|rm|rmvb|mxf|nut|nsv|wtv|dvr-ms|amv|flc|fli|roq|bik|y4m|ivf|dv|mpv|tod|m3u8|mpd)(?:[?#]|$)/i;

export function isPlayableVideoPath(path: string): boolean {
  return VIDEO_FILE_RE.test(path);
}

export function stripPlayableVideoExtension(name: string): string {
  return isPlayableVideoPath(name) ? name.replace(VIDEO_FILE_RE, "") : name;
}
