import type { MutableRefObject } from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { HlsLifecycleState } from '../playbackLifecycle'

export function usePlaybackSeekFrame(
  videoRef: MutableRefObject<HTMLVideoElement | null>,
  lifecycleState: HlsLifecycleState,
) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const visibleRef = useRef(false)
  const pausedAtSeekRef = useRef(false)
  const [visible, setVisible] = useState(false)

  const clear = useCallback(() => {
    visibleRef.current = false
    setVisible(false)
  }, [])

  const capture = useCallback(
    (wasPaused: boolean) => {
      if (visibleRef.current) {
        return
      }
      const video = videoRef.current
      const canvas = canvasRef.current
      if (
        video === null ||
        canvas === null ||
        video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA ||
        video.videoWidth === 0 ||
        video.videoHeight === 0
      ) {
        return
      }

      try {
        canvas.width = video.videoWidth
        canvas.height = video.videoHeight
        const context = canvas.getContext('2d')
        if (context === null) {
          return
        }
        context.drawImage(video, 0, 0, canvas.width, canvas.height)
        pausedAtSeekRef.current = wasPaused
        visibleRef.current = true
        setVisible(true)
      } catch {
        // A browser may refuse to copy a protected or cross-origin video frame.
      }
    },
    [videoRef],
  )

  const onSeeked = useCallback(() => {
    if (!visibleRef.current) return
    const video = videoRef.current
    if (video === null) return
    if (typeof video.requestVideoFrameCallback === 'function') {
      video.requestVideoFrameCallback(() => clear())
    } else if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
      clear()
    }
  }, [clear, videoRef])

  const onCanPlay = useCallback(() => {
    if (pausedAtSeekRef.current) {
      onSeeked()
    }
  }, [onSeeked])

  useEffect(() => {
    if (lifecycleState === 'error') {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- an error ends the seek overlay
      clear()
    }
  }, [clear, lifecycleState])

  return { canvasRef, visible, capture, onSeeked, onCanPlay, onPlaying: onSeeked, onError: clear }
}
