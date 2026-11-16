"""Bounded, seekable HTTP range reader for NITF metadata and small complex chips."""

import io
import urllib.request
from collections import OrderedDict


class HTTPRangeReader(io.RawIOBase):
    def __init__(self, url, budget=192 * 1024**2, block_size=65536):
        super().__init__()
        if not url.startswith(
            "https://umbra-open-data-catalog.s3.us-west-2.amazonaws.com/"
        ):
            raise ValueError("Only verified Umbra public assets are supported")
        self.name = url
        self.url = url
        with urllib.request.urlopen(
            urllib.request.Request(url, method="HEAD"), timeout=30
        ) as r:
            self.size = int(r.headers["Content-Length"])
        self.pos = 0
        self.block_size = block_size
        self.budget = budget
        self.downloaded = 0
        self.cache = OrderedDict()

    def readable(self):
        return True

    def seekable(self):
        return True

    def tell(self):
        return self.pos

    def seek(self, offset, whence=0):
        target = (
            offset
            if whence == 0
            else self.pos + offset
            if whence == 1
            else self.size + offset
        )
        if target < 0:
            raise ValueError("Negative seek")
        self.pos = target
        return target

    def read(self, n=-1):
        if n is None or n < 0:
            n = self.size - self.pos
        n = min(n, self.size - self.pos)
        if n <= 0:
            return b""
        if n > self.budget:
            raise ValueError("Remote read exceeds download budget")
        chunks = []
        while n:
            block = self.pos // self.block_size
            if block not in self.cache:
                start = block * self.block_size
                # Batch adjacent blocks for a long NITF row/strip read, avoiding
                # hundreds of sequential requests for a contiguous complex chip.
                needed_end = (
                    (self.pos + n + self.block_size - 1) // self.block_size
                ) * self.block_size
                end = min(needed_end, start + 8 * 1024**2, self.size) - 1
                if self.downloaded + end - start + 1 > self.budget:
                    raise ValueError(
                        "Remote read budget exceeded; choose a smaller ROI"
                    )
                req = urllib.request.Request(
                    self.url, headers={"Range": f"bytes={start}-{end}"}
                )
                with urllib.request.urlopen(req, timeout=45) as r:
                    if r.status != 206:
                        raise ValueError("Server did not honor HTTP Range")
                    data = r.read(end - start + 2)
                if len(data) != end - start + 1:
                    raise ValueError("Incomplete range response")
                self.downloaded += len(data)
                for offset in range(0, len(data), self.block_size):
                    self.cache[(start + offset) // self.block_size] = data[
                        offset : offset + self.block_size
                    ]
                while len(self.cache) > 128:
                    self.cache.popitem(last=False)
            data = self.cache[block]
            offset = self.pos % self.block_size
            part = data[offset : offset + n]
            chunks.append(part)
            self.pos += len(part)
            n -= len(part)
        return b"".join(chunks)

    def readinto(self, b):
        data = self.read(len(b))
        b[: len(data)] = data
        return len(data)
