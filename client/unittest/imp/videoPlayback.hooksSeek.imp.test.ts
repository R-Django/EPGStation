import type { MutableRefObject } from 'react'
import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  usePlaybackSeek,
  type ResumeAfterRestart,
} from '@/features/video/playback/hooks/usePlaybackSeek'

function ref<T>(value: T): MutableRefObject<T> {
  return { current: value }
}

function makeVideo({
  currentTime = 0,
  duration = NaN,
  playbackRate = 1,
}: { currentTime?: number; duration?: number; playbackRate?: number } = {}): HTMLVideoElement {
  const video = document.createElement('video')
  Object.defineProperty(video, 'currentTime', {
    configurable: true,
    value: currentTime,
    writable: true,
  })
  Object.defineProperty(video, 'duration', { configurable: true, value: duration })
  Object.defineProperty(video, 'playbackRate', {
    configurable: true,
    value: playbackRate,
    writable: true,
  })

  return video
}

function captureAnimationFrames() {
  const callbacks: FrameRequestCallback[] = []
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
    callbacks.push(callback)
    return callbacks.length
  })
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => undefined)
  return () => {
    const callback = callbacks.shift()
    if (callback === undefined) throw new Error('No pending animation frame')
    act(() => callback(0))
  }
}

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

function setup(
  overrides: {
    videoRef?: MutableRefObject<HTMLVideoElement | null>
    isPausedRef?: MutableRefObject<boolean>
    kind?: string
    canSeek?: boolean
    activeBaseSeekSeconds?: number
    activePlaybackStartUrl?: string
    duration?: number
    effectiveDuration?: number
    currentTime?: number
    onBeforeSeek?: (wasPaused: boolean) => void
  } = {},
) {
  const videoRef = overrides.videoRef ?? ref<HTMLVideoElement | null>(null)
  const isPausedRef = overrides.isPausedRef ?? ref(false)
  const resumeAfterRestartRef = ref<ResumeAfterRestart | null>(null)
  const setCurrentTime = vi.fn()
  const restartPlaybackAt = vi.fn()

  const { result, rerender, unmount } = renderHook(
    (props: {
      currentTime: number
      duration: number
      effectiveDuration: number
      activePlaybackStartUrl: string | undefined
    }) =>
      usePlaybackSeek({
        kind: overrides.kind ?? 'live',
        videoRef,
        isPausedRef,
        resumeAfterRestartRef,
        currentTime: props.currentTime,
        setCurrentTime,
        duration: props.duration,
        effectiveDuration: props.effectiveDuration,
        canSeek: overrides.canSeek ?? true,
        activeBaseSeekSeconds: overrides.activeBaseSeekSeconds ?? 0,
        activePlaybackStartUrl: props.activePlaybackStartUrl,
        restartPlaybackAt,
        onBeforeSeek: overrides.onBeforeSeek,
      }),
    {
      initialProps: {
        currentTime: overrides.currentTime ?? 0,
        duration: overrides.duration ?? 100,
        effectiveDuration: overrides.effectiveDuration ?? 100,
        activePlaybackStartUrl: overrides.activePlaybackStartUrl,
      },
    },
  )

  return {
    result,
    rerender,
    unmount,
    videoRef,
    isPausedRef,
    resumeAfterRestartRef,
    setCurrentTime,
    restartPlaybackAt,
  }
}

describe('usePlaybackSeek seekBy contract', () => {
  it('seekBy does nothing without a mounted video element', () => {
    const { result, setCurrentTime } = setup()

    act(() => {
      result.current.seekBy(10)
    })

    // No video and canSeek defaults true, but seekBy short-circuits without a video.
    expect(setCurrentTime).not.toHaveBeenCalled()
  })

  it('does nothing when seeking is not allowed', () => {
    const video = makeVideo()
    const { result, setCurrentTime } = setup({ videoRef: ref(video), canSeek: false })

    act(() => {
      result.current.seekBy(10)
    })

    expect(setCurrentTime).not.toHaveBeenCalled()
  })

  it('[AC 4.14] seeks a direct (non recorded-streaming) video by setting currentTime absolutely', () => {
    const video = makeVideo({ currentTime: 5 })
    const { result, setCurrentTime } = setup({ videoRef: ref(video), kind: 'live' })

    act(() => {
      result.current.seekBy(10)
    })

    expect(video.currentTime).toBe(10)
    expect(setCurrentTime).toHaveBeenCalledWith(10)
  })

  it.each(['recorded-direct', 'live'])('captures a frame before %s in-place seeking', (kind) => {
    const video = makeVideo({ currentTime: 5 })
    const capture = vi.fn()
    const { result } = setup({ videoRef: ref(video), kind, onBeforeSeek: capture })
    act(() => result.current.seekBy(10))
    expect(capture).toHaveBeenCalledExactlyOnceWith(false)
    expect(video.currentTime).toBe(10)
  })

  it.each(['hls', 'webm', 'mp4'])('captures a frame before %s stream restart', (format) => {
    const nextFrame = captureAnimationFrames()
    const video = makeVideo({ currentTime: 5, duration: 60 })
    const capture = vi.fn()
    const { result, restartPlaybackAt } = setup({
      videoRef: ref(video),
      kind: 'recorded-streaming',
      activeBaseSeekSeconds: 100,
      activePlaybackStartUrl: `./api/streams/recorded/1/${format}?mode=0&ss=100`,
      currentTime: 105,
      effectiveDuration: 500,
      onBeforeSeek: capture,
    })
    act(() => result.current.seekBy(100))
    expect(capture).toHaveBeenCalledExactlyOnceWith(false)
    expect(restartPlaybackAt).not.toHaveBeenCalled()
    nextFrame()
    expect(restartPlaybackAt).not.toHaveBeenCalled()
    nextFrame()
    expect(restartPlaybackAt).toHaveBeenCalledOnce()
  })

  it('[AC 5.3] seeks within the current recorded-streaming segment relative to the segment start', () => {
    const video = makeVideo({ currentTime: 5, duration: 60 })
    const { result } = setup({
      videoRef: ref(video),
      kind: 'recorded-streaming',
      activeBaseSeekSeconds: 100,
      activePlaybackStartUrl: './api/streams/recorded/1/webm?mode=0&ss=100',
      currentTime: 105,
      effectiveDuration: 500,
    })

    act(() => {
      result.current.seekBy(10)
    })

    // absolute target 115, minus the 100s base = 15s relative to the loaded segment
    expect(video.currentTime).toBe(15)
  })

  it('[AC 5.3] keeps the absolute time without restarting when there is no active playback start URL', () => {
    const video = makeVideo({ currentTime: 5, duration: 60 })
    const { result, restartPlaybackAt, setCurrentTime } = setup({
      videoRef: ref(video),
      kind: 'recorded-streaming',
      activeBaseSeekSeconds: 100,
      activePlaybackStartUrl: undefined,
      currentTime: 5,
      duration: 60,
      effectiveDuration: 500,
    })

    act(() => {
      result.current.seekBy(400)
    })

    expect(restartPlaybackAt).not.toHaveBeenCalled()
    expect(setCurrentTime).toHaveBeenCalledWith(405)
  })

  it('[AC 5.3] restarts playback with a rebuilt URL and preserves rate/paused state for an out-of-segment seek', () => {
    const nextFrame = captureAnimationFrames()
    const video = makeVideo({ currentTime: 5, duration: 60, playbackRate: 1.5 })
    const isPausedRef = ref(true)
    const { result, restartPlaybackAt, resumeAfterRestartRef } = setup({
      videoRef: ref(video),
      isPausedRef,
      kind: 'recorded-streaming',
      activeBaseSeekSeconds: 100,
      activePlaybackStartUrl: './api/streams/recorded/1/webm?mode=0&ss=100',
      currentTime: 5,
      duration: 60,
      effectiveDuration: 500,
    })

    act(() => {
      result.current.seekBy(400)
    })

    nextFrame()
    nextFrame()

    expect(restartPlaybackAt).toHaveBeenCalledWith('./api/streams/recorded/1/webm?mode=0&ss=405')
    expect(resumeAfterRestartRef.current).toStrictEqual({ playbackRate: 1.5, wasPaused: true })
  })

  it('uses the last target when another seek arrives before the stream restarts', () => {
    const nextFrame = captureAnimationFrames()
    const video = makeVideo({ currentTime: 5, duration: 60 })
    const { result, restartPlaybackAt } = setup({
      videoRef: ref(video),
      kind: 'recorded-streaming',
      activeBaseSeekSeconds: 100,
      activePlaybackStartUrl: './api/streams/recorded/1/webm?mode=0&ss=100',
      currentTime: 105,
      effectiveDuration: 500,
    })
    act(() => result.current.seekBy(100))
    act(() => result.current.seekBy(115))
    nextFrame()
    nextFrame()
    expect(restartPlaybackAt).not.toHaveBeenCalled()
    nextFrame()
    expect(restartPlaybackAt).toHaveBeenCalledExactlyOnceWith(
      './api/streams/recorded/1/webm?mode=0&ss=220',
    )
  })

  it('ignores a cancelled second animation frame and restarts at the latest seek target', () => {
    const nextFrame = captureAnimationFrames()
    const video = makeVideo({ currentTime: 5, duration: 60, playbackRate: 1.5 })
    const { result, restartPlaybackAt, resumeAfterRestartRef } = setup({
      videoRef: ref(video),
      kind: 'recorded-streaming',
      activeBaseSeekSeconds: 100,
      activePlaybackStartUrl: './api/streams/recorded/1/webm?mode=0&ss=100',
      currentTime: 105,
      effectiveDuration: 500,
    })

    act(() => result.current.seekBy(100))
    nextFrame()
    act(() => result.current.seekBy(115))
    nextFrame()
    expect(restartPlaybackAt).not.toHaveBeenCalled()
    expect(resumeAfterRestartRef.current).toBeNull()

    nextFrame()
    expect(restartPlaybackAt).not.toHaveBeenCalled()
    nextFrame()
    expect(restartPlaybackAt).toHaveBeenCalledExactlyOnceWith(
      './api/streams/recorded/1/webm?mode=0&ss=220',
    )
    expect(resumeAfterRestartRef.current).toStrictEqual({ playbackRate: 1.5, wasPaused: false })
  })

  it('ignores a cancelled hidden-page timer and restarts at the latest seek target', () => {
    captureAnimationFrames()
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const setTimeout = vi.spyOn(window, 'setTimeout')
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValueOnce('hidden')
    const video = makeVideo({ currentTime: 5, duration: 60, playbackRate: 1.5 })
    const { result, restartPlaybackAt, resumeAfterRestartRef } = setup({
      videoRef: ref(video),
      kind: 'recorded-streaming',
      activeBaseSeekSeconds: 100,
      activePlaybackStartUrl: './api/streams/recorded/1/webm?mode=0&ss=100',
      currentTime: 105,
      effectiveDuration: 500,
    })

    act(() => result.current.seekBy(100))
    const cancelledTimer = setTimeout.mock.calls.find(([, delay]) => delay === 200)?.[0]
    setTimeout.mockRestore()
    if (typeof cancelledTimer !== 'function') throw new Error('No pending hidden-page timer')

    act(() => result.current.seekBy(115))
    act(() => cancelledTimer())
    expect(restartPlaybackAt).not.toHaveBeenCalled()
    expect(resumeAfterRestartRef.current).toBeNull()

    act(() => vi.advanceTimersByTime(200))
    expect(restartPlaybackAt).toHaveBeenCalledExactlyOnceWith(
      './api/streams/recorded/1/webm?mode=0&ss=220',
    )
    expect(resumeAfterRestartRef.current).toStrictEqual({ playbackRate: 1.5, wasPaused: false })
  })

  it.each(['hls', 'webm', 'mp4'])(
    'keeps the target time while a %s stream restart waits for the next paint',
    (format) => {
      const nextFrame = captureAnimationFrames()
      const video = makeVideo({ currentTime: 50, duration: 60 })
      const { result, setCurrentTime, restartPlaybackAt } = setup({
        videoRef: ref(video),
        kind: 'recorded-streaming',
        activeBaseSeekSeconds: 100,
        activePlaybackStartUrl: `./api/streams/recorded/1/${format}?mode=0&ss=100`,
        currentTime: 150,
        effectiveDuration: 500,
      })

      act(() => result.current.seekBy(30))
      expect(setCurrentTime).toHaveBeenLastCalledWith(180)
      setCurrentTime.mockClear()

      video.currentTime = 51
      act(() => result.current.handleTimeUpdate())
      expect(setCurrentTime).not.toHaveBeenCalled()
      expect(restartPlaybackAt).not.toHaveBeenCalled()

      nextFrame()
      act(() => result.current.handleTimeUpdate())
      expect(setCurrentTime).not.toHaveBeenCalled()

      nextFrame()
      expect(restartPlaybackAt).toHaveBeenCalledExactlyOnceWith(
        `./api/streams/recorded/1/${format}?mode=0&ss=180`,
      )
    },
  )

  it('does not restart a stream after the player unmounts', () => {
    const nextFrame = captureAnimationFrames()
    const video = makeVideo({ duration: 60 })
    const { result, unmount, restartPlaybackAt } = setup({
      videoRef: ref(video),
      kind: 'recorded-streaming',
      activeBaseSeekSeconds: 100,
      activePlaybackStartUrl: './api/streams/recorded/1/webm?mode=0&ss=100',
      effectiveDuration: 500,
    })
    act(() => result.current.seekBy(205))
    unmount()
    nextFrame()
    expect(restartPlaybackAt).not.toHaveBeenCalled()
  })

  it('discards a pending restart when the playback URL changes', () => {
    const nextFrame = captureAnimationFrames()
    const video = makeVideo({ duration: 60 })
    const { result, rerender, restartPlaybackAt } = setup({
      videoRef: ref(video),
      kind: 'recorded-streaming',
      activeBaseSeekSeconds: 100,
      activePlaybackStartUrl: './api/streams/recorded/1/webm?mode=0&ss=100',
      effectiveDuration: 500,
    })
    act(() => result.current.seekBy(205))
    rerender({
      currentTime: 0,
      duration: 100,
      effectiveDuration: 500,
      activePlaybackStartUrl: './api/streams/recorded/2/webm?mode=0&ss=0',
    })
    nextFrame()
    expect(restartPlaybackAt).not.toHaveBeenCalled()
  })

  it('keeps an in-range seek when it replaces a pending stream restart', () => {
    const nextFrame = captureAnimationFrames()
    const video = makeVideo({ duration: 60 })
    const activePlaybackStartUrl = './api/streams/recorded/1/webm?mode=0&ss=100'
    const { result, rerender, restartPlaybackAt, resumeAfterRestartRef, setCurrentTime } = setup({
      videoRef: ref(video),
      kind: 'recorded-streaming',
      activeBaseSeekSeconds: 100,
      activePlaybackStartUrl,
      effectiveDuration: 500,
    })
    act(() => result.current.seekBy(205))
    rerender({ currentTime: 110, duration: 100, effectiveDuration: 500, activePlaybackStartUrl })
    act(() => result.current.seekBy(5))
    nextFrame()
    expect(video.currentTime).toBe(15)
    expect(restartPlaybackAt).not.toHaveBeenCalled()
    expect(resumeAfterRestartRef.current).toBeNull()
    setCurrentTime.mockClear()
    act(() => result.current.handleTimeUpdate())
    expect(setCurrentTime).toHaveBeenCalledExactlyOnceWith(115)
  })

  it('waits for a paint opportunity after a seek bar commit', () => {
    const nextFrame = captureAnimationFrames()
    const video = makeVideo({ duration: 60 })
    const { result, restartPlaybackAt } = setup({
      videoRef: ref(video),
      kind: 'recorded-streaming',
      activeBaseSeekSeconds: 100,
      activePlaybackStartUrl: './api/streams/recorded/1/hls?mode=0&ss=100',
      effectiveDuration: 500,
    })
    act(() => result.current.previewSeekBarTime(205))
    act(() => result.current.commitSeekBarTime())
    expect(restartPlaybackAt).not.toHaveBeenCalled()
    nextFrame()
    expect(restartPlaybackAt).not.toHaveBeenCalled()
    nextFrame()
    expect(restartPlaybackAt).toHaveBeenCalledExactlyOnceWith(
      './api/streams/recorded/1/hls?mode=0&ss=205',
    )
  })

  it('commits a seek bar position once when pointer and mouse release both fire', () => {
    const nextFrame = captureAnimationFrames()
    const video = makeVideo({ duration: 60 })
    const capture = vi.fn()
    const { result, restartPlaybackAt } = setup({
      videoRef: ref(video),
      kind: 'recorded-streaming',
      activeBaseSeekSeconds: 100,
      activePlaybackStartUrl: './api/streams/recorded/1/hls?mode=0&ss=100',
      effectiveDuration: 500,
      onBeforeSeek: capture,
    })
    const input = document.createElement('input')
    input.value = '205'
    result.current.rangeSeekElementRef.current = input
    act(() => result.current.previewSeekBarTime(205))
    act(() => result.current.commitSeekBarTime())
    act(() => result.current.commitSeekBarTime())
    expect(capture).toHaveBeenCalledTimes(1)
    nextFrame()
    nextFrame()
    expect(restartPlaybackAt).toHaveBeenCalledOnce()
  })

  it('uses a timer only when the page is hidden before the next paint', () => {
    captureAnimationFrames()
    vi.useFakeTimers()
    const video = makeVideo({ duration: 60 })
    const { result, restartPlaybackAt } = setup({
      videoRef: ref(video),
      kind: 'recorded-streaming',
      activeBaseSeekSeconds: 100,
      activePlaybackStartUrl: './api/streams/recorded/1/webm?mode=0&ss=100',
      effectiveDuration: 500,
    })
    act(() => result.current.seekBy(205))
    act(() => vi.advanceTimersByTime(200))
    expect(restartPlaybackAt).not.toHaveBeenCalled()

    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
    act(() => vi.advanceTimersByTime(200))
    expect(restartPlaybackAt).toHaveBeenCalledExactlyOnceWith(
      './api/streams/recorded/1/webm?mode=0&ss=205',
    )
  })

  it('clamps a negative/non-finite seek target to zero', () => {
    const video = makeVideo({ currentTime: 5 })
    const { result } = setup({ videoRef: ref(video), kind: 'live', canSeek: true })

    act(() => {
      // deltaSeconds pushes currentTime below zero; clampPlaybackSeek clamps it to 0.
      result.current.seekBy(-1000)
    })

    expect(video.currentTime).toBe(0)
  })

  it('falls back to the effective duration when the loaded segment duration is unavailable', () => {
    const video = makeVideo({ currentTime: 5, duration: NaN })
    const { result } = setup({
      videoRef: ref(video),
      kind: 'recorded-streaming',
      activeBaseSeekSeconds: 0,
      activePlaybackStartUrl: './api/streams/recorded/1/webm?mode=0&ss=0',
      currentTime: 5,
      duration: 60,
      effectiveDuration: 60,
    })

    act(() => {
      result.current.seekBy(10)
    })

    expect(video.currentTime).toBe(15)
  })
})
