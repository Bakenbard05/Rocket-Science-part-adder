using System;
using System.IO;
using System.Text;
using UnityEngine;

namespace PartRotatorExtension.PartLoader
{
    /// <summary>
    /// Reads a wave file (PCM, 16 bit) into an audio clip. The game has no
    /// public API for that, so the sounds of the mod parts are decoded here.
    /// </summary>
    internal static class WaveReader
    {
        internal static AudioClip Read(string path)
        {
            byte[] data;
            try
            {
                data = File.ReadAllBytes(path);
            }
            catch (Exception)
            {
                return null;
            }

            if (data.Length < 44 || data[0] != 'R' || data[1] != 'I' || data[2] != 'F' || data[3] != 'F')
            {
                return null;
            }

            int channels = 0;
            int frequency = 0;
            int bits = 0;
            int dataOffset = -1;
            int dataLength = 0;

            int position = 12;
            while (position + 8 <= data.Length)
            {
                string id = Encoding.ASCII.GetString(data, position, 4);
                int size = BitConverter.ToInt32(data, position + 4);
                int body = position + 8;
                if (size < 0 || body > data.Length)
                {
                    break;
                }

                if (id == "fmt ")
                {
                    channels = BitConverter.ToInt16(data, body + 2);
                    frequency = BitConverter.ToInt32(data, body + 4);
                    bits = BitConverter.ToInt16(data, body + 14);
                }
                else if (id == "data")
                {
                    dataOffset = body;
                    dataLength = Math.Min(size, data.Length - body);
                }

                position = body + size + (size % 2);
            }

            if (dataOffset < 0 || channels <= 0 || frequency <= 0 || bits != 16)
            {
                return null;
            }

            int samples = dataLength / (2 * channels);
            if (samples <= 0)
            {
                return null;
            }

            var buffer = new float[samples * channels];
            int offset = dataOffset;
            for (int i = 0; i < buffer.Length; i++)
            {
                buffer[i] = BitConverter.ToInt16(data, offset) / 32768f;
                offset += 2;
            }

            AudioClip clip = AudioClip.Create(
                Path.GetFileNameWithoutExtension(path),
                samples,
                channels,
                frequency,
                false);
            clip.SetData(buffer, 0);
            return clip;
        }
    }
}
