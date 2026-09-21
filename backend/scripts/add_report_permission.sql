-- Script SQL para agregar permiso report:financial:read a usuarios existentes
-- que no lo tengan en su array de permisos

UPDATE "user"
SET permissions = permissions || '{"report:financial:read"}'::jsonb
WHERE 
    is_admin = false 
    AND NOT (permissions @> '["report:financial:read"]'::jsonb);

-- Verificar cuántos usuarios fueron actualizados
SELECT 
    COUNT(*) as usuarios_actualizados
FROM "user"
WHERE 
    is_admin = false 
    AND permissions @> '["report:financial:read"]'::jsonb;
