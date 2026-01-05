export interface VideoMetadata {
  id: string;
  title: string;
  duration: number; // in seconds
}

export interface ChannelMetadata {
  title?: string;
  videos: VideoMetadata[];
}
