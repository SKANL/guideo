export interface MediaProbeResult {
  readonly durationMs: number;
  readonly hasAudio: boolean;
  readonly hasVideo: boolean;
}

export interface MediaProbe {
  probe(path: string): Promise<MediaProbeResult>;
}
