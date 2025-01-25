const createStream = (data)=> {
    return new ReadableStream({
        async start(controller) {
            controller.enqueue(data);
            controller.close();
        },
    });
};

export async function decompressGzipped(data) {
    try {
        const stream = createStream(data);
        if (!stream) throw new Error('Failed to create stream from data');

        return await decompressGzipStream(stream);
    } catch (error) {
        console.error('Error decompressing gzipped data:', error);
        throw error;
    }
}

export async function decompressGzipStream(stream) {
    const decompressedStream = stream.pipeThrough(new DecompressionStream('gzip'));
    const response = new Response(decompressedStream);
    const buffer = await response.arrayBuffer();

    return new Uint8Array(buffer);
}

export async function compressGzipped(data) {
    try {
        const stream = createStream(data);
        const compressedStream = stream.pipeThrough(new CompressionStream('gzip'));
        const response = new Response(compressedStream);
        const buffer = await response.arrayBuffer();

        return new Uint8Array(buffer);
    } catch (error) {
        console.error('Error compressing gzipped data:', error);
        throw error;
    }
}
