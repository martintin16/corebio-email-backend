import { MigrationInterface, QueryRunner } from 'typeorm';
import { templateNameKey } from '../../templates/template-name';

/**
 * Plantillas — nombre único sin distinguir mayúsculas NI TILDES (contrato del
 * front). `name_key` guarda el nombre normalizado (ver templateNameKey) y el
 * índice único pasa a ser sobre (mailbox_id, name_key).
 *
 * Las plantillas que ya existen se completan acá. Si dos de una misma casilla
 * solo se diferenciaban por tildes, a la segunda se le agrega " (2)", " (3)"…
 * para que la migración no falle.
 */
export class TemplateNameKey1791400000000 implements MigrationInterface {
  name = 'TemplateNameKey1791400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE public.templates ADD COLUMN name_key text NULL`);

    const rows: { id: string; mailbox_id: string; name: string }[] = await queryRunner.query(
      `SELECT id, mailbox_id, name FROM public.templates ORDER BY created_at, id`,
    );
    const used = new Set<string>();
    for (const row of rows) {
      let name = row.name;
      let key = templateNameKey(name);
      for (let n = 2; used.has(`${row.mailbox_id}:${key}`); n++) {
        name = `${row.name} (${n})`;
        key = templateNameKey(name);
      }
      used.add(`${row.mailbox_id}:${key}`);
      await queryRunner.query(
        `UPDATE public.templates SET name = $2, name_key = $3 WHERE id = $1`,
        [row.id, name, key],
      );
    }

    await queryRunner.query(`ALTER TABLE public.templates ALTER COLUMN name_key SET NOT NULL`);
    await queryRunner.query(`DROP INDEX IF EXISTS public.templates_mailbox_name_key`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX templates_mailbox_name_key_unique ON public.templates (mailbox_id, name_key)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS public.templates_mailbox_name_key_unique`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX templates_mailbox_name_key ON public.templates (mailbox_id, lower(name))`,
    );
    await queryRunner.query(`ALTER TABLE public.templates DROP COLUMN IF EXISTS name_key`);
  }
}
