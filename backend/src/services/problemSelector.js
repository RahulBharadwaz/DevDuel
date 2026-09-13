const codeforcesService = require('./codeforcesService');

// Curated seed problems covering all standard rating buckets (800-3500)
// Used as immediate bootstrap or fallback if Codeforces API is undergoing maintenance
const FALLBACK_PROBLEMS = [
  { contestId: 4, index: 'A', name: 'Watermelon', rating: 800, tags: ['brute force', 'math'] },
  { contestId: 71, index: 'A', name: 'Way Too Long Words', rating: 800, tags: ['strings'] },
  { contestId: 231, index: 'A', name: 'Team', rating: 800, tags: ['brute force'] },
  { contestId: 158, index: 'A', name: 'Next Round', rating: 800, tags: ['special problem'] },
  { contestId: 112, index: 'A', name: 'Petya and Strings', rating: 800, tags: ['implementation', 'strings'] },
  { contestId: 282, index: 'A', name: 'Bit++', rating: 800, tags: ['implementation'] },
  { contestId: 50, index: 'A', name: 'Domino piling', rating: 800, tags: ['greedy', 'math'] },
  { contestId: 96, index: 'A', name: 'Football', rating: 900, tags: ['implementation', 'strings'] },
  { contestId: 160, index: 'A', name: 'Twins', rating: 900, tags: ['greedy', 'sortings'] },
  { contestId: 318, index: 'A', name: 'Even Odds', rating: 900, tags: ['math'] },
  { contestId: 58, index: 'A', name: 'Chat room', rating: 1000, tags: ['greedy', 'strings'] },
  { contestId: 69, index: 'A', name: 'Young Physicist', rating: 1000, tags: ['math'] },
  { contestId: 118, index: 'A', name: 'String Task', rating: 1000, tags: ['strings'] },
  { contestId: 122, index: 'A', name: 'Lucky Division', rating: 1000, tags: ['brute force', 'number theory'] },
  { contestId: 158, index: 'B', name: 'Taxi', rating: 1100, tags: ['greedy', 'special problem'] },
  { contestId: 467, index: 'B', name: 'Fedor and New Game', rating: 1100, tags: ['bitmasks', 'brute force'] },
  { contestId: 492, index: 'B', name: 'Vanya and Lanterns', rating: 1200, tags: ['binary search', 'math', 'sortings'] },
  { contestId: 479, index: 'A', name: 'Expression', rating: 1000, tags: ['brute force', 'math'] },
  { contestId: 230, index: 'B', name: 'T-primes', rating: 1300, tags: ['binary search', 'math', 'number theory'] },
  { contestId: 459, index: 'B', name: 'Pashmak and Flowers', rating: 1300, tags: ['combinatorics', 'sortings'] },
  { contestId: 25, index: 'A', name: 'IQ test', rating: 1300, tags: ['brute force'] },
  { contestId: 489, index: 'C', name: 'Given Length and Sum of Digits...', rating: 1400, tags: ['dp', 'greedy'] },
  { contestId: 520, index: 'B', name: 'Two Buttons', rating: 1400, tags: ['dfs and similar', 'graphs', 'greedy', 'math'] },
  { contestId: 698, index: 'A', name: 'Vacations', rating: 1400, tags: ['dp'] },
  { contestId: 580, index: 'C', name: 'Kefa and Park', rating: 1500, tags: ['dfs and similar', 'graphs', 'trees'] },
  { contestId: 550, index: 'C', name: 'Divisibility by Eight', rating: 1500, tags: ['brute force', 'dp', 'math'] },
  { contestId: 455, index: 'A', name: 'Boredom', rating: 1500, tags: ['dp'] },
  { contestId: 1398, index: 'C', name: 'Good Subarrays', rating: 1600, tags: ['data structures', 'math'] },
  { contestId: 189, index: 'A', name: 'Cut Ribbon', rating: 1300, tags: ['dp'] },
  { contestId: 1538, index: 'D', name: 'Another Problem About Dividing Numbers', rating: 1700, tags: ['math', 'number theory'] },
  { contestId: 1624, index: 'E', name: 'Masha-forgetful', rating: 1800, tags: ['dp', 'hashing', 'strings'] },
  { contestId: 1676, index: 'H2', name: 'Maximum Crossings (Hard Version)', rating: 1900, tags: ['data structures', 'divide and conquer'] },
  { contestId: 1772, index: 'F', name: 'Copy of a Copy of a Copy', rating: 2000, tags: ['constructive algorithms', 'dfs and similar'] },
  { contestId: 1744, index: 'F', name: 'MEX vs MED', rating: 2100, tags: ['brute force', 'math', 'two pointers'] },
  { contestId: 1833, index: 'G', name: 'Ksyusha and Chinchilla', rating: 2200, tags: ['dfs and similar', 'dp', 'greedy', 'trees'] },
  { contestId: 1846, index: 'G', name: 'Rudolf and CodeVid-23', rating: 2300, tags: ['bitmasks', 'graphs', 'shortest paths'] },
  { contestId: 1801, index: 'D', name: 'The Way Home', rating: 2400, tags: ['dp', 'graphs', 'shortest paths'] },
  { contestId: 1778, index: 'E', name: 'The Labyrinth', rating: 2500, tags: ['data structures', 'trees'] },
  { contestId: 1842, index: 'G', name: 'Tenzing and Random Operations', rating: 2600, tags: ['combinatorics', 'dp', 'math', 'probabilities'] },
  { contestId: 1774, index: 'G', name: 'Segment Covering', rating: 2700, tags: ['data structures', 'divide and conquer', 'dp'] },
  { contestId: 1787, index: 'G', name: 'Colorful Tree', rating: 2800, tags: ['data structures', 'trees'] },
  { contestId: 1738, index: 'G', name: 'Anti-Adjacent Swaps', rating: 2900, tags: ['constructive algorithms', 'greedy'] },
  { contestId: 1761, index: 'F2', name: 'Anti-subsequence (Hard Version)', rating: 3000, tags: ['constructive algorithms', 'trees'] },
  { contestId: 1844, index: 'H', name: 'Multiple of Three', rating: 3100, tags: ['combinatorics', 'math'] },
  { contestId: 1656, index: 'H', name: 'Equal LCM Subsets', rating: 3200, tags: ['data structures', 'math', 'number theory'] },
  { contestId: 1770, index: 'G', name: 'Koxia and Bracket', rating: 3300, tags: ['data structures', 'divide and conquer'] },
  { contestId: 1834, index: 'F', name: 'Typewriter', rating: 3400, tags: ['data structures', 'divide and conquer'] },
  { contestId: 1815, index: 'F', name: 'OH MY GOD', rating: 3500, tags: ['graphs', 'math'] }
];

class ProblemSelector {
  constructor(ttlMs = 12 * 60 * 60 * 1000) { // 12 hours TTL default
    this.ttlMs = ttlMs;
    this.cachedProblems = [];
    this.problemsByRating = new Map(); // rating -> Array<Problem>
    this.lastFetchedAt = null;
    this.fetchPromise = null;
    
    // Seed with curated fallback problems on instantiation
    this._indexProblems(FALLBACK_PROBLEMS);
  }

  /**
   * Helper to index problems by rating for fast O(1) bucket lookups
   */
  _indexProblems(problems) {
    const validProblems = [];
    const ratingMap = new Map();

    for (const p of problems) {
      // Must have rating, contestId, index, name, and be standard programming type
      if (!p || typeof p.rating !== 'number' || !p.contestId || !p.index || !p.name) {
        continue;
      }
      if (p.rating < 800 || p.rating > 3500) {
        continue;
      }
      if (p.type && p.type !== 'PROGRAMMING') {
        continue;
      }

      const normalized = {
        contestId: Number(p.contestId),
        index: String(p.index).trim().toUpperCase(),
        name: String(p.name).trim(),
        rating: Number(p.rating),
        tags: Array.isArray(p.tags) ? p.tags : [],
        url: `https://codeforces.com/problemset/problem/${p.contestId}/${p.index}`
      };

      validProblems.push(normalized);

      if (!ratingMap.has(normalized.rating)) {
        ratingMap.set(normalized.rating, []);
      }
      ratingMap.get(normalized.rating).push(normalized);
    }

    if (validProblems.length > 0) {
      this.cachedProblems = validProblems;
      this.problemsByRating = ratingMap;
      this.lastFetchedAt = Date.now();
    }
  }

  /**
   * Check if cache is fresh according to TTL
   */
  isCacheFresh() {
    if (!this.lastFetchedAt || this.cachedProblems.length === 0) {
      return false;
    }
    return (Date.now() - this.lastFetchedAt) < this.ttlMs;
  }

  /**
   * Refreshes the problemset from Codeforces API with in-memory caching and lock
   * @param {boolean} force - Force refresh even if cache is fresh
   */
  async refreshCache(force = false) {
    if (!force && this.isCacheFresh()) {
      return {
        cached: true,
        count: this.cachedProblems.length,
        lastFetchedAt: this.lastFetchedAt
      };
    }

    // Prevent concurrent duplicate API calls (cache stampede protection)
    if (this.fetchPromise) {
      return this.fetchPromise;
    }

    this.fetchPromise = (async () => {
      try {
        console.log('[ProblemSelector] Fetching latest problemset from Codeforces API...');
        const rawProblems = await codeforcesService.fetchProblemset();
        this._indexProblems(rawProblems);
        console.log(`[ProblemSelector] Successfully cached and indexed ${this.cachedProblems.length} rated problems.`);
        return {
          cached: false,
          count: this.cachedProblems.length,
          lastFetchedAt: this.lastFetchedAt
        };
      } catch (err) {
        console.warn(`[ProblemSelector] Codeforces API fetch failed: ${err.message}. Retaining current cache of ${this.cachedProblems.length} problems.`);
        // If we have no problems at all, seed with fallback
        if (this.cachedProblems.length === 0) {
          this._indexProblems(FALLBACK_PROBLEMS);
        }
        return {
          cached: true,
          count: this.cachedProblems.length,
          lastFetchedAt: this.lastFetchedAt,
          warning: err.message
        };
      } finally {
        this.fetchPromise = null;
      }
    })();

    return this.fetchPromise;
  }

  /**
   * Get a random problem for a specific target rating (800 - 3500)
   * @param {object} options
   * @param {number} options.targetRating - Codeforces rating (800 to 3500)
   * @param {Array<string>|Set<string>} options.excludeProblemIds - Problem IDs to exclude (e.g. ['4A', '71A'])
   * @param {Array<string>} options.handles - Optional Codeforces handles to automatically exclude their solved problems
   * @returns {Promise<object>} Standardized problem object
   */
  async getRandomProblem({ targetRating, excludeProblemIds = [], handles = [] } = {}) {
    // 1. Ensure cache is loaded
    if (!this.isCacheFresh()) {
      await this.refreshCache();
    }

    // 2. Validate and normalize rating
    const rating = Number(targetRating);
    if (isNaN(rating) || rating < 800 || rating > 3500) {
      throw new Error(`Invalid target rating: ${targetRating}. Rating must be between 800 and 3500.`);
    }

    // 3. Build exclusion set
    const exclusionSet = new Set(
      Array.from(excludeProblemIds).map(id => String(id).toUpperCase().trim())
    );

    // If handles are supplied, retrieve their solved problems
    if (Array.isArray(handles) && handles.length > 0) {
      for (const handle of handles) {
        if (handle) {
          const solved = await codeforcesService.getUserSolvedProblemIds(handle);
          for (const pid of solved) {
            exclusionSet.add(pid);
          }
        }
      }
    }

    // 4. Find matching candidate pool
    let candidates = (this.problemsByRating.get(rating) || []).filter(p => {
      const pid = `${p.contestId}${p.index}`;
      return !exclusionSet.has(pid);
    });

    // If no candidate available at exact rating due to high exclusions, expand window by +/- 100
    if (candidates.length === 0) {
      console.warn(`[ProblemSelector] No available problem found for exact rating ${rating}. Expanding search window...`);
      const adjacentRatings = [rating - 100, rating + 100].filter(r => r >= 800 && r <= 3500);
      for (const adj of adjacentRatings) {
        const adjCandidates = (this.problemsByRating.get(adj) || []).filter(p => {
          const pid = `${p.contestId}${p.index}`;
          return !exclusionSet.has(pid);
        });
        if (adjCandidates.length > 0) {
          candidates = adjCandidates;
          break;
        }
      }
    }

    // Fallback: If still empty (e.g. extreme exclusions), allow previously solved if necessary
    if (candidates.length === 0) {
      candidates = this.problemsByRating.get(rating) || FALLBACK_PROBLEMS.filter(p => p.rating === rating);
    }

    if (!candidates || candidates.length === 0) {
      throw new Error(`No problem available for rating ${rating}`);
    }

    // 5. Select uniform random problem
    const randomIndex = Math.floor(Math.random() * candidates.length);
    const chosen = candidates[randomIndex];

    return {
      contestId: chosen.contestId,
      index: chosen.index,
      name: chosen.name,
      rating: chosen.rating,
      tags: chosen.tags,
      url: chosen.url || `https://codeforces.com/problemset/problem/${chosen.contestId}/${chosen.index}`
    };
  }

  /**
   * Get current cache stats and problem counts by rating
   */
  getStats() {
    const breakdown = {};
    for (const [rating, list] of this.problemsByRating.entries()) {
      breakdown[rating] = list.length;
    }

    return {
      isCached: this.isCacheFresh(),
      totalProblems: this.cachedProblems.length,
      lastFetchedAt: this.lastFetchedAt ? new Date(this.lastFetchedAt).toISOString() : null,
      ttlMs: this.ttlMs,
      ratingsDistribution: breakdown
    };
  }
}

module.exports = new ProblemSelector();
