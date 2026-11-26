-- Allow signed-in technicians to end their own independent binome.
-- The SECURITY DEFINER function validates auth.uid(), active account status,
-- and rejects company-managed teams before making any changes.
GRANT EXECUTE ON FUNCTION public.separate_my_team(date) TO authenticated;
