export interface MediaProbeResult {
  readonly durationMs: number;
  readonly hasAudio: boolean;
  readonly hasVideo: boolean;
  readonly videoCodec?: string;
  readonly audioCodec?: string;
  readonly width?: number;
  readonly height?: number;
  readonly videoStreams?: number;
  readonly audioStreams?: number;
  readonly subtitleStreams?: number;
  readonly syncP95Ms?: number;
  readonly frozenFrameRatio?: number;
  readonly blackFrameRatio?: number;
  readonly evidence?: { readonly command: "ffprobe"; readonly path: string; readonly argv: readonly string[] };
}

export interface MediaProbe {
  probe(path: string): Promise<MediaProbeResult>;
}
