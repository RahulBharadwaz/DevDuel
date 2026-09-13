const CODEFORCES_API_BASE = 'https://codeforces.com/api';

/**
 * Service to interface with official Codeforces REST API
 * Documentation: https://codeforces.com/apiHelp
 */
class CodeforcesService {
  constructor(baseUrl = CODEFORCES_API_BASE) {
    this.baseUrl = baseUrl;
    this.timeoutMs = 10000;
  }

  /**
   * Helper to perform HTTP GET requests with timeout and error handling
   */
  async _fetchJson(endpoint) {
    const url = `${this.baseUrl}/${endpoint}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'DevDuel-Platform/1.0'
        }
      });

      const data = await response.json().catch(() => null);

      if (!response.ok) {
        const errorMsg = data?.comment || `HTTP ${response.status} ${response.statusText}`;
        throw new Error(`Codeforces API error: ${errorMsg}`);
      }

      if (data?.status !== 'OK') {
        throw new Error(`Codeforces API returned status ${data?.status}: ${data?.comment || 'Unknown error'}`);
      }

      return data.result;
    } catch (err) {
      if (err.name === 'AbortError') {
        throw new Error(`Codeforces API request timed out after ${this.timeoutMs}ms`);
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Check if a Codeforces handle exists and return profile metadata
   * @param {string} handle - Codeforces username
   * @returns {Promise<{ exists: boolean, user?: object }>}
   */
  async verifyHandleExists(handle) {
    if (!handle || typeof handle !== 'string') {
      return { exists: false };
    }

    const trimmed = handle.trim();
    if (!trimmed) return { exists: false };

    try {
      const result = await this._fetchJson(`user.info?handles=${encodeURIComponent(trimmed)}`);
      if (Array.isArray(result) && result.length > 0) {
        const user = result[0];
        return {
          exists: true,
          user: {
            handle: user.handle,
            rating: user.rating || 0,
            maxRating: user.maxRating || 0,
            rank: user.rank || 'unranked',
            maxRank: user.maxRank || 'unranked',
            avatar: user.titlePhoto || user.avatar
          }
        };
      }
      return { exists: false };
    } catch (err) {
      // If CF returns "handle not found", it means the user does not exist
      if (err.message && err.message.toLowerCase().includes('not found')) {
        return { exists: false };
      }
      // For network / timeout errors, rethrow so callers know it was an infrastructure issue
      throw err;
    }
  }

  /**
   * Fetch the full problemset catalog from Codeforces
   * @returns {Promise<Array<object>>} - List of raw problem objects
   */
  async fetchProblemset() {
    const result = await this._fetchJson('problemset.problems');
    if (!result || !Array.isArray(result.problems)) {
      throw new Error('Malformed problemset response from Codeforces API');
    }
    return result.problems;
  }

  /**
   * Fetch recent submissions for a given handle
   * @param {string} handle - Codeforces handle
   * @param {number} count - Number of submissions to fetch (default: 20)
   * @returns {Promise<Array<object>>}
   */
  async getUserSubmissions(handle, count = 20) {
    const trimmed = handle.trim();
    const result = await this._fetchJson(
      `user.status?handle=${encodeURIComponent(trimmed)}&from=1&count=${Math.max(1, count)}`
    );
    return Array.isArray(result) ? result : [];
  }

  /**
   * Retrieve set of problem keys (e.g. "1234A") solved with verdict "OK" by a handle
   * @param {string} handle 
   * @returns {Promise<Set<string>>}
   */
  async getUserSolvedProblemIds(handle) {
    try {
      const submissions = await this.getUserSubmissions(handle, 100);
      const solved = new Set();

      for (const sub of submissions) {
        if (sub.verdict === 'OK' && sub.problem?.contestId && sub.problem?.index) {
          solved.add(`${sub.problem.contestId}${sub.problem.index.toUpperCase()}`);
        }
      }

      return solved;
    } catch (err) {
      console.warn(`[CF Service] Could not fetch solved problems for handle "${handle}": ${err.message}`);
      return new Set();
    }
  }
}

module.exports = new CodeforcesService();
