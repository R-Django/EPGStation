import styles from '../PlaybackPage.module.css'

export interface PlaybackVideoElementProps {
  assignVideoRef: (node: HTMLVideoElement | null) => void
  src: string | undefined
  onCanPlay: () => void
  onDurationChange: () => void
  onEmptied: () => void
  onError: () => void
  onLoadedData: () => void
  onLoadedMetadata: () => void
  onLoadStart: () => void
  onPause: () => void
  onPlay: () => void
  onPlaying: () => void
  onRateChange: () => void
  onSeeking: () => void
  onTimeUpdate: () => void
  onVolumeChange: () => void
}

export function PlaybackVideoElement({
  assignVideoRef,
  src,
  onCanPlay,
  onDurationChange,
  onEmptied,
  onError,
  onLoadedData,
  onLoadedMetadata,
  onLoadStart,
  onPause,
  onPlay,
  onPlaying,
  onRateChange,
  onSeeking,
  onTimeUpdate,
  onVolumeChange,
}: PlaybackVideoElementProps) {
  return (
    <video
      ref={assignVideoRef}
      autoPlay
      className={styles.mediaElement}
      playsInline
      src={src}
      onCanPlay={onCanPlay}
      onDurationChange={onDurationChange}
      onEmptied={onEmptied}
      onError={onError}
      onLoadedData={onLoadedData}
      onLoadedMetadata={onLoadedMetadata}
      onLoadStart={onLoadStart}
      onPause={onPause}
      onPlay={onPlay}
      onPlaying={onPlaying}
      onRateChange={onRateChange}
      onSeeking={onSeeking}
      onTimeUpdate={onTimeUpdate}
      onVolumeChange={onVolumeChange}
    />
  )
}
