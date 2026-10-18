// Disposable bounded diagnostic: touch a requested allocation and report the
// kernel's own peak RSS. No filesystem/network effects or child processes.
#include <stdio.h>
#include <stdlib.h>
#include <stdint.h>
#include <sys/resource.h>
#include <unistd.h>
int main(int argc, char **argv) {
  if (argc != 3) return 2;
  unsigned long mib = strtoul(argv[1], NULL, 10), hold_ms = strtoul(argv[2], NULL, 10);
  if (!mib || mib > 900 || hold_ms > 5000) return 2;
  size_t bytes = (size_t)mib * 1024 * 1024;
  volatile unsigned char *p = malloc(bytes);
  if (!p) return 3;
  for (size_t i = 0; i < bytes; i += 4096) p[i] = (unsigned char)(i / 4096);
  if (hold_ms) usleep((useconds_t)hold_ms * 1000);
  struct rusage usage;
  if (getrusage(RUSAGE_SELF, &usage)) return 4;
#ifdef __APPLE__
  unsigned long long peak = usage.ru_maxrss;
#else
  unsigned long long peak = (unsigned long long)usage.ru_maxrss * 1024;
#endif
  printf("{\"allocated\":%zu,\"peakRSS\":%llu,\"done\":true}\n", bytes, peak);
  free((void *)p);
  return 0;
}
