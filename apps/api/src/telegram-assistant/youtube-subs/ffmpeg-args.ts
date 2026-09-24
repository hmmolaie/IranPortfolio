export type SubtitleStyle = {
  fontName: string;
  fontSize: number;
  marginV: number;
  outline: number;
  fontsDir: string;
  srtPath: string;
};

export function escapeFfmpegFilterPath(filePath: string): string {
  return filePath.replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "\\'");
}

/** آرگومان‌های ffmpeg بدون shell تا تزریق دستور ممکن نباشد */
export function buildFfmpegArgs(input: string, output: string, style: SubtitleStyle): string[] {
  const srt = escapeFfmpegFilterPath(style.srtPath);
  const fonts = escapeFfmpegFilterPath(style.fontsDir);
  const force = [
    `FontName=${style.fontName}`,
    `FontSize=${style.fontSize}`,
    `MarginV=${style.marginV}`,
    `Outline=${style.outline}`,
    'BorderStyle=1',
    'Alignment=2',
    'PrimaryColour=&H00FFFFFF',
    'OutlineColour=&H00000000',
    'BackColour=&H80000000',
    'WrapStyle=0',
  ].join(',');
  const vf = `subtitles='${srt}':charenc=UTF-8:fontsdir='${fonts}':force_style='${force}'`;
  return [
    '-y',
    '-i',
    input,
    '-vf',
    vf,
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
    '-crf',
    '23',
    '-c:a',
    'aac',
    '-b:a',
    '128k',
    '-movflags',
    '+faststart',
    output,
  ];
}
