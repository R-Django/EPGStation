import { describe, expect, it, vi } from 'vitest';

import { baseConfig, compiled, executionManager, fakeStream, logger } from './_media-harness';

const StreamApiModel = compiled<any>('model', 'api', 'stream', 'StreamApiModel.js').default;
const StreamManageModel = compiled<any>('model', 'service', 'stream', 'manager', 'StreamManageModel.js').default;

describe('recorded HLS preset selection', () => {
    it.each([
        { cmd: '/bin/nice -n 2 %FFMPEG% -i pipe:0 -f hls output.m3u8', early: true },
        { cmd: '%NODE% -i pipe:0', early: false },
        { cmd: '%FFMPEG% -f hls output.m3u8', early: false },
        { cmd: '%FFMPEG% -i pipe:0 -i other.ts', early: false },
        { cmd: '%FFMPEG% -i other.ts', early: false },
        { cmd: '%FFMPEG% -i pipe:0 %INPUT%', early: false },
    ])('uses the expected startup path for $cmd', async ({ cmd, early }) => {
        const config = baseConfig();
        config.stream.recorded.ts.hls[0].cmd = cmd;
        const source = {
            inputPath: 'synthetic/recorded.ts',
            kind: 'completed-file-reader' as const,
            playPosition: 10,
            recordedId: 41,
            videoFileId: 31,
            videoInfo: { bitRate: 8, duration: 60, size: 480 },
        };
        const consumer = {
            acquireAndOpen: vi.fn(async (_id, _position, _active, { onCompletedTsResolved }) => {
                onCompletedTsResolved();
                return { release: async () => undefined, source };
            }),
        };
        const stream = fakeStream({ type: 'RecordedHLS' });
        const writer = vi.fn(async () => {
            expect(stream.adoptPlaybackSource).not.toHaveBeenCalled();
        });
        Object.assign(stream, { startHlsWriterEarly: writer });
        const manager = new StreamManageModel(
            { getLogger: logger },
            executionManager(),
            { notifyClient: vi.fn() },
            undefined,
            consumer,
        );
        const api = new StreamApiModel(
            { getConfig: () => config },
            async () => fakeStream(),
            async () => fakeStream(),
            async () => fakeStream(),
            async () => stream,
            manager,
            {},
            {},
            {},
            {},
            {},
            consumer,
        );

        const streamId = await api.startRecordedHLSStream({ mode: 0, playPosition: 10, videoFileId: 31 });
        try {
            expect(writer).toHaveBeenCalledTimes(early ? 1 : 0);
            expect(stream.setOption).toHaveBeenCalledExactlyOnceWith({ cmd, playPosition: 10, videoFileId: 31 }, 0);
            expect(stream.adoptPlaybackSource).toHaveBeenCalledExactlyOnceWith(source, expect.any(Function));
        } finally {
            await manager.stop(streamId);
        }
    });
});
