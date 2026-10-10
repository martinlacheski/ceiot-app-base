/* Minimal assert-style test runner (no external framework). */
#ifndef TEST_UTIL_H
#define TEST_UTIL_H

#include <stdio.h>

static int g_test_failures = 0;
static int g_test_count = 0;

#define CHECK(cond)                                                         \
    do {                                                                    \
        if (!(cond)) {                                                      \
            g_test_failures++;                                              \
            printf("  FAIL %s:%d: %s\n", __FILE__, __LINE__, #cond);        \
        }                                                                   \
    } while (0)

#define RUN(fn)                                                             \
    do {                                                                    \
        int before_ = g_test_failures;                                      \
        g_test_count++;                                                     \
        fn();                                                               \
        printf("%s %s\n", g_test_failures == before_ ? "[ok]  " : "[FAIL]", #fn); \
    } while (0)

#define TEST_MAIN_END()                                                     \
    do {                                                                    \
        printf("%d tests, %d failed checks\n", g_test_count, g_test_failures); \
        return g_test_failures == 0 ? 0 : 1;                                \
    } while (0)

#endif
