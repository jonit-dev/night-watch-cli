/**
 * SQLite implementation of IArticleRepository.
 * Provides access to article data for internal linking and generation.
 */

import Database from 'better-sqlite3';
import { inject, injectable } from 'tsyringe';

import { IArticleRepository, IInternalLinkRef } from '../interfaces.js';

interface IArticleLinkRow {
  title: string | null;
  published_url: string | null;
}

@injectable()
export class SqliteArticleRepository implements IArticleRepository {
  private readonly db: Database.Database;

  constructor(@inject('Database') db: Database.Database) {
    this.db = db;
  }

  /**
   * Get published articles for a project, returning title and URL for internal linking.
   * Only returns articles that have both a title and published_url.
   */
  getPublishedLinks(projectId: string, limit: number): IInternalLinkRef[] {
    const rows = this.db
      .prepare<[string, number], IArticleLinkRow>(
        `SELECT title, published_url
         FROM articles
         WHERE project_id = ? AND status = 'published' AND published_url IS NOT NULL
         ORDER BY created_at DESC
         LIMIT ?`,
      )
      .all(projectId, limit);

    return rows
      .filter(
        (row): row is IArticleLinkRow & { title: string; published_url: string } =>
          row.title !== null && row.published_url !== null,
      )
      .map((row) => ({
        title: row.title,
        url: row.published_url,
      }));
  }
}
