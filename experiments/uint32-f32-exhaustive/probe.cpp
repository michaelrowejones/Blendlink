#include <array>
#include <bit>
#include <cfenv>
#include <chrono>
#include <cstdint>
#include <cstdio>
#include <limits>
#include <thread>

#pragma STDC FP_CONTRACT OFF

static_assert(sizeof(float) == 4 && std::numeric_limits<float>::is_iec559);
static_assert(std::numeric_limits<float>::radix == 2 && std::numeric_limits<float>::digits == 24);
static_assert(std::numeric_limits<uint32_t>::digits == 32);

// Independent reference expression: binary32 uint conversion, then binary32 divide.
// UINT32_MAX itself rounds to 2^32 under the required RN-even environment.
float reference(uint32_t u) {
  return static_cast<float>(u) / static_cast<float>(UINT32_MAX);
}

float integer_law(uint32_t u) {
  const unsigned top = u ? 31u - std::countl_zero(u) : 0u;
  const unsigned shift = top > 23u ? top - 23u : 0u;
  uint32_t mant = u >> shift;
  if (shift) {
    const uint32_t remainder = u & ((uint32_t(1) << shift) - 1u);
    const uint32_t half = uint32_t(1) << (shift - 1u);
    mant += remainder > half || (remainder == half && (mant & 1u));
  }
  const float scale = std::bit_cast<float>(uint32_t(95u + shift) << 23u);
  return static_cast<float>(mant) * scale;
}

struct Result {
  uint64_t checked = 0, mismatches = 0, reference_sum = 0, law_sum = 0;
  uint32_t first_u = 0, first_reference = 0, first_law = 0;
  std::array<uint64_t, 9> shifts{};
  int initial_round = -1, final_round = -1;
};

int main() {
  constexpr unsigned workers = 8;
  constexpr uint64_t count = uint64_t(1) << 32;
  if (std::fegetround() != FE_TONEAREST ||
      std::bit_cast<uint32_t>(static_cast<float>(UINT32_MAX)) != 0x4f800000u) {
    std::fputs("host must use IEEE binary32 RN-even without changing its FPU\n", stderr);
    return 2;
  }
  std::array<Result, workers> results{};
  std::array<std::thread, workers> threads;
  const auto start = std::chrono::steady_clock::now();
  for (unsigned i = 0; i < workers; ++i) {
    threads[i] = std::thread([&, i] {
      Result &r = results[i];
      r.initial_round = std::fegetround();
      if (r.initial_round != FE_TONEAREST) return;
      const uint64_t begin = count * i / workers, end = count * (i + 1) / workers;
      for (uint64_t wide = begin; wide < end; ++wide) {
        const uint32_t u = static_cast<uint32_t>(wide);
        const uint32_t a = std::bit_cast<uint32_t>(reference(u));
        const uint32_t b = std::bit_cast<uint32_t>(integer_law(u));
        if (a != b) {
          if (!r.mismatches) { r.first_u = u; r.first_reference = a; r.first_law = b; }
          ++r.mismatches;
        }
        const unsigned top = u ? 31u - std::countl_zero(u) : 0u;
        ++r.shifts[top > 23u ? top - 23u : 0u];
        ++r.checked;
        r.reference_sum += a;
        r.law_sum += b;
      }
      r.final_round = std::fegetround();
    });
  }
  for (auto &t : threads) t.join();
  const double seconds = std::chrono::duration<double>(std::chrono::steady_clock::now() - start).count();
  uint64_t checked = 0, mismatches = 0, reference_sum = 0, law_sum = 0;
  std::array<uint64_t, 9> shifts{};
  bool round_unchanged = std::fegetround() == FE_TONEAREST;
  for (const auto &r : results) {
    checked += r.checked; mismatches += r.mismatches;
    reference_sum += r.reference_sum; law_sum += r.law_sum;
    for (unsigned i = 0; i < shifts.size(); ++i) shifts[i] += r.shifts[i];
    round_unchanged &= r.initial_round == FE_TONEAREST && r.final_round == FE_TONEAREST;
    if (r.mismatches) std::fprintf(stderr, "first mismatch %08x: %08x vs %08x\n", r.first_u, r.first_reference, r.first_law);
  }
  std::printf("{\"checked\":%llu,\"mismatches\":%llu,\"seconds\":%.9f,\"workers\":%u,\"roundingUnchangedNearestEven\":%s,\"referenceWordSum\":\"%llu\",\"lawWordSum\":\"%llu\",\"shiftCounts\":[",
              checked, mismatches, seconds, workers, round_unchanged ? "true" : "false", reference_sum, law_sum);
  for (unsigned i = 0; i < shifts.size(); ++i) std::printf("%s%llu", i ? "," : "", shifts[i]);
  std::puts("]}");
  return checked == count && mismatches == 0 && round_unchanged ? 0 : 1;
}
