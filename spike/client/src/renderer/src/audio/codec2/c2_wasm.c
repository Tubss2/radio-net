#include "codec2.h"
#include <stdlib.h>
#include <string.h>

#define C2_MAX_SAMPLES 320
#define C2_MAX_BYTES 16

typedef struct {
  struct CODEC2 *enc;
  struct CODEC2 *dec;
  int samples;
  int bytes;
  short in[C2_MAX_SAMPLES];
  short out[C2_MAX_SAMPLES];
  unsigned char bits[C2_MAX_BYTES];
} C2State;

C2State *c2_open(void) {
  C2State *s = (C2State *)calloc(1, sizeof(C2State));
  if (!s) return 0;
  s->enc = codec2_create(CODEC2_MODE_2400);
  s->dec = codec2_create(CODEC2_MODE_2400);
  if (!s->enc || !s->dec) return 0;
  s->samples = codec2_samples_per_frame(s->enc);
  s->bytes = codec2_bytes_per_frame(s->enc);
  return s;
}

void c2_close(C2State *s) {
  if (!s) return;
  if (s->enc) codec2_destroy(s->enc);
  if (s->dec) codec2_destroy(s->dec);
  free(s);
}

int c2_samples(C2State *s) { return s->samples; }
int c2_bytes(C2State *s) { return s->bytes; }
short *c2_in(C2State *s) { return s->in; }
short *c2_out(C2State *s) { return s->out; }

/* Encode then decode `frames` consecutive frames packed in s->in. */
void c2_process(C2State *s, int frames) {
  if (frames < 1) frames = 1;
  if (frames > 2) frames = 2;
  for (int i = 0; i < frames; i++) {
    codec2_encode(s->enc, s->bits, s->in + i * s->samples);
    codec2_decode(s->dec, s->out + i * s->samples, s->bits);
  }
}
