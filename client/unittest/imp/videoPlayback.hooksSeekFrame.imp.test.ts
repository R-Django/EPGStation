import type { MutableRefObject } from 'react'
import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { usePlaybackSeekFrame } from '@/features/video/playback/hooks/usePlaybackSeekFrame'
import type { HlsLifecycleState } from '@/features/video/playback/playbackLifecycle'

function makeVideo(): HTMLVideoElement {
  const video = document.createElement('video')
  Object.defineProperties(video, {
    readyState: { configurable: true, value: HTMLMediaElement.HAVE_CURRENT_DATA },
    videoWidth: { configurable: true, value: 1920 },
    videoHeight: { configurable: true, value: 1080 },
  })
  return video
}

describe('seek frame for playback formats', () => {
  afterEach(() => vi.restoreAllMocks())

  it('[AC 5.7] retains the previous frame until the new stream plays', () => {
    const video = makeVideo()
    const drawImage = vi.fn()
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage } as never)
    const videoRef = { current: video } as MutableRefObject<HTMLVideoElement | null>
    const { result } = renderHook(() => usePlaybackSeekFrame(videoRef, 'ready'))
    result.current.canvasRef.current = document.createElement('canvas')

    act(() => result.current.capture(false))
    expect(result.current.visible).toBe(true)
    expect(result.current.canvasRef.current?.width).toBe(1920)
    expect(drawImage).toHaveBeenCalledWith(video, 0, 0, 1920, 1080)
    act(() => result.current.onCanPlay())
    expect(result.current.visible).toBe(true)
    act(() => result.current.onPlaying())
    expect(result.current.visible).toBe(false)
  })

  it('[AC 5.7] clears a paused seek on canplay and clears failures', () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      drawImage: vi.fn(),
    } as never)
    const videoRef = { current: makeVideo() } as MutableRefObject<HTMLVideoElement | null>
    const { result, rerender } = renderHook(({ state }) => usePlaybackSeekFrame(videoRef, state), {
      initialProps: { state: 'ready' as HlsLifecycleState },
    })
    result.current.canvasRef.current = document.createElement('canvas')
    act(() => result.current.capture(true))
    act(() => result.current.onCanPlay())
    expect(result.current.visible).toBe(false)
    act(() => result.current.capture(false))
    rerender({ state: 'error' })
    expect(result.current.visible).toBe(false)
  })

  it('keeps the normal player when a frame cannot be captured', () => {
    const getContext = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
    const videoRef = { current: makeVideo() } as MutableRefObject<HTMLVideoElement | null>
    const { result } = renderHook(() => usePlaybackSeekFrame(videoRef, 'ready'))
    result.current.canvasRef.current = document.createElement('canvas')
    act(() => result.current.capture(false))
    expect(getContext).toHaveBeenCalledOnce()
    expect(result.current.visible).toBe(false)
  })

  it('clears a paused or playing in-place seek after the next presented frame', () => {
    const video = makeVideo()
    const callbacks: Array<VideoFrameRequestCallback> = []
    video.requestVideoFrameCallback = vi.fn((callback) => {
      callbacks.push(callback)
      return callbacks.length
    })
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      drawImage: vi.fn(),
    } as never)
    const videoRef = { current: video } as MutableRefObject<HTMLVideoElement | null>
    const { result } = renderHook(() => usePlaybackSeekFrame(videoRef, 'ready'))
    result.current.canvasRef.current = document.createElement('canvas')

    act(() => result.current.capture(false))
    act(() => result.current.onSeeked())
    expect(result.current.visible).toBe(true)
    act(() => callbacks[0](0, {} as VideoFrameCallbackMetadata))
    expect(result.current.visible).toBe(false)
  })
})
